import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma?: any;
  inMemoryDb?: Record<string, any[]>;
};

// Initialize store for local environment without mock data
if (!globalForPrisma.inMemoryDb) {
  globalForPrisma.inMemoryDb = {
    User: [],
    Plan: [],
    Subscription: [],
    Transaction: [],
    PredictionPost: [],
    PredictionItem: [],
    MediaAsset: [],
    FreeAccessRule: [],
    ComplimentaryAccess: [],
    AuditLog: [],
    CmsSection: [],
    UserSession: [],
    PasswordResetToken: [],
  };
}

function matchFilter(record: any, where: any): boolean {
  if (!where || Object.keys(where).length === 0) return true;
  for (const [key, val] of Object.entries(where)) {
    if (val === undefined) continue;
    if (key === 'OR' && Array.isArray(val)) {
      if (!val.some((sub) => matchFilter(record, sub))) return false;
      continue;
    }
    if (key === 'AND' && Array.isArray(val)) {
      if (!val.every((sub) => matchFilter(record, sub))) return false;
      continue;
    }
    if (key === 'NOT') {
      if (matchFilter(record, val)) return false;
      continue;
    }

    const recVal = record[key];
    if (typeof val === 'object' && val !== null && !(val instanceof Date)) {
      const v = val as any;
      if ('equals' in v && recVal !== v.equals) return false;
      if ('in' in v && (!Array.isArray(v.in) || !v.in.includes(recVal))) return false;
      if ('notIn' in v && Array.isArray(v.notIn) && v.notIn.includes(recVal)) return false;
      if ('not' in v && recVal !== v.not) return false;
      if ('gte' in v) {
        const d1 = new Date(recVal as any).getTime();
        const d2 = new Date(v.gte as any).getTime();
        if (d1 < d2) return false;
      }
      if ('lte' in v) {
        const d1 = new Date(recVal as any).getTime();
        const d2 = new Date(v.lte as any).getTime();
        if (d1 > d2) return false;
      }
      if ('gt' in v) {
        const d1 = new Date(recVal as any).getTime();
        const d2 = new Date(v.gt as any).getTime();
        if (d1 <= d2) return false;
      }
      if ('lt' in v) {
        const d1 = new Date(recVal as any).getTime();
        const d2 = new Date(v.lt as any).getTime();
        if (d1 >= d2) return false;
      }
      if ('contains' in v) {
        const str = String(recVal ?? '').toLowerCase();
        const sub = String(v.contains).toLowerCase();
        if (!str.includes(sub)) return false;
      }
    } else {
      if (recVal instanceof Date && val instanceof Date) {
        if (recVal.getTime() !== val.getTime()) return false;
      } else if (recVal !== val) {
        return false;
      }
    }
  }
  return true;
}

function resolveRelations(modelName: string, record: any, include?: any): any {
  if (!include || !record) return record;
  const clone = { ...record };
  const db = globalForPrisma.inMemoryDb!;

  if (include.items && modelName === 'PredictionPost') {
    clone.items = db.PredictionItem.filter((item) => item.postId === record.id);
  }
  if (include.media && modelName === 'PredictionPost') {
    clone.media = db.MediaAsset.filter((m) => m.postId === record.id);
  }
  if (include.plan && modelName === 'Subscription') {
    clone.plan = db.Plan.find((p) => p.id === record.planId) || null;
  }
  if (include.user && (modelName === 'Subscription' || modelName === 'Transaction' || modelName === 'ComplimentaryAccess' || modelName === 'AuditLog')) {
    clone.user = db.User.find((u) => u.id === (record.userId || record.actorId)) || null;
  }
  if (include.actor && modelName === 'AuditLog') {
    clone.actor = db.User.find((u) => u.id === record.actorId) || null;
  }
  if (include.post && modelName === 'ComplimentaryAccess') {
    clone.post = db.PredictionPost.find((p) => p.id === record.postId) || null;
  }
  if (include.subscriptions && modelName === 'User') {
    clone.subscriptions = db.Subscription.filter((s) => s.userId === record.id).map((s) =>
      include.subscriptions?.include ? resolveRelations('Subscription', s, include.subscriptions.include) : s
    );
  }
  if (include.transactions && modelName === 'User') {
    clone.transactions = db.Transaction.filter((t) => t.userId === record.id);
  }

  return clone;
}

function createInMemoryModel(modelName: string) {
  return {
    findMany: async (args: any = {}) => {
      const db = globalForPrisma.inMemoryDb!;
      const list = db[modelName] || [];
      let results = list.filter((r) => matchFilter(r, args.where));
      if (args.orderBy) {
        const [sortKey, sortDir] = Object.entries(args.orderBy)[0] as [string, any];
        results.sort((a, b) => {
          if (a[sortKey] < b[sortKey]) return sortDir === 'desc' ? 1 : -1;
          if (a[sortKey] > b[sortKey]) return sortDir === 'desc' ? -1 : 1;
          return 0;
        });
      }
      if (args.skip) results = results.slice(args.skip);
      if (args.take) results = results.slice(0, args.take);
      return results.map((r) => resolveRelations(modelName, r, args.include));
    },
    findFirst: async (args: any = {}) => {
      const db = globalForPrisma.inMemoryDb!;
      const list = db[modelName] || [];
      const item = list.find((r) => matchFilter(r, args.where));
      return item ? resolveRelations(modelName, item, args.include) : null;
    },
    findUnique: async (args: any = {}) => {
      const db = globalForPrisma.inMemoryDb!;
      const list = db[modelName] || [];
      const item = list.find((r) => matchFilter(r, args.where));
      return item ? resolveRelations(modelName, item, args.include) : null;
    },
    create: async (args: any) => {
      const db = globalForPrisma.inMemoryDb!;
      if (!db[modelName]) db[modelName] = [];
      const newRecord = {
        id: args.data?.id || `${modelName.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...args.data,
      };
      db[modelName].push(newRecord);
      return resolveRelations(modelName, newRecord, args.include);
    },
    createMany: async (args: any) => {
      const db = globalForPrisma.inMemoryDb!;
      if (!db[modelName]) db[modelName] = [];
      const dataList = Array.isArray(args.data) ? args.data : [args.data];
      for (const item of dataList) {
        db[modelName].push({
          id: item.id || `${modelName.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...item,
        });
      }
      return { count: dataList.length };
    },
    update: async (args: any) => {
      const db = globalForPrisma.inMemoryDb!;
      const list = db[modelName] || [];
      const idx = list.findIndex((r) => matchFilter(r, args.where));
      if (idx === -1) throw new Error(`Record not found for update in ${modelName}`);
      list[idx] = { ...list[idx], ...args.data, updatedAt: new Date() };
      return resolveRelations(modelName, list[idx], args.include);
    },
    updateMany: async (args: any) => {
      const db = globalForPrisma.inMemoryDb!;
      const list = db[modelName] || [];
      let count = 0;
      for (let i = 0; i < list.length; i++) {
        if (matchFilter(list[i], args.where)) {
          list[i] = { ...list[i], ...args.data, updatedAt: new Date() };
          count++;
        }
      }
      return { count };
    },
    delete: async (args: any) => {
      const db = globalForPrisma.inMemoryDb!;
      const list = db[modelName] || [];
      const idx = list.findIndex((r) => matchFilter(r, args.where));
      if (idx === -1) throw new Error(`Record not found for delete in ${modelName}`);
      const [removed] = list.splice(idx, 1);
      return removed;
    },
    deleteMany: async (args: any = {}) => {
      const db = globalForPrisma.inMemoryDb!;
      const list = db[modelName] || [];
      const remaining = list.filter((r) => !matchFilter(r, args.where));
      const count = list.length - remaining.length;
      db[modelName] = remaining;
      return { count };
    },
    count: async (args: any = {}) => {
      const db = globalForPrisma.inMemoryDb!;
      const list = db[modelName] || [];
      return list.filter((r) => matchFilter(r, args.where)).length;
    },
    upsert: async (args: any) => {
      const db = globalForPrisma.inMemoryDb!;
      const list = db[modelName] || [];
      const idx = list.findIndex((r) => matchFilter(r, args.where));
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...args.update, updatedAt: new Date() };
        return resolveRelations(modelName, list[idx], args.include);
      } else {
        const newRecord = {
          id: `${modelName.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...args.create,
        };
        list.push(newRecord);
        return resolveRelations(modelName, newRecord, args.include);
      }
    },
  };
}

function createClientWrapper(): any {
  let realClient: any = null;
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '') {
    try {
      realClient = new PrismaClient({ log: [] });
    } catch {
      realClient = null;
    }
  }

  return new Proxy(realClient || {}, {
    get(target, prop: string) {
      if (prop === '$transaction') {
        return async (arg: any) => {
          if (Array.isArray(arg)) {
            return Promise.all(arg);
          }
          if (typeof arg === 'function') {
            return arg(proxyClient);
          }
          return [];
        };
      }
      if (prop === '$connect' || prop === '$disconnect') {
        return async () => {};
      }

      // Map model property names
      const modelKeyMap: Record<string, string> = {
        user: 'User',
        plan: 'Plan',
        subscription: 'Subscription',
        transaction: 'Transaction',
        predictionPost: 'PredictionPost',
        predictionItem: 'PredictionItem',
        mediaAsset: 'MediaAsset',
        freeAccessRule: 'FreeAccessRule',
        complimentaryAccess: 'ComplimentaryAccess',
        auditLog: 'AuditLog',
        cmsSection: 'CmsSection',
        userSession: 'UserSession',
        passwordResetToken: 'PasswordResetToken',
      };

      const normalizedModel = modelKeyMap[prop] || (prop.charAt(0).toUpperCase() + prop.slice(1));
      const inMemoryModel = createInMemoryModel(normalizedModel);

      if (realClient && target[prop]) {
        // Wrap real model calls with fallback
        return new Proxy(target[prop], {
          get(modelTarget, method: string) {
            return async (...args: any[]) => {
              try {
                return await modelTarget[method](...args);
              } catch (err: any) {
                console.warn(`[Prisma Database fallback for ${prop}.${method}]:`, err?.message || err);
                if (inMemoryModel[method as keyof typeof inMemoryModel]) {
                  return await (inMemoryModel as any)[method](...args);
                }
                throw err;
              }
            };
          },
        });
      }

      return inMemoryModel;
    },
  });
}

const proxyClient = globalForPrisma.prisma ?? createClientWrapper();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = proxyClient;

export const prisma = proxyClient as unknown as PrismaClient;


