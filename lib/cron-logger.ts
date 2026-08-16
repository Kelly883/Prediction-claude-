import { prisma } from './prisma';

export type CronJobStatus = 'success' | 'failed';

export async function logCronExecution(
  jobName: string,
  status: CronJobStatus,
  startedAt: Date,
  finishedAt: Date,
  metadata?: Record<string, unknown>,
  error?: string
) {
  try {
    await prisma.cronExecutionLog.create({
      data: {
        jobName,
        status,
        startedAt,
        finishedAt,
        metadata,
        error,
      },
    });
  } catch (err) {
    // Non-fatal: if logging fails, don't break the cron job
    console.error(`Failed to log cron execution for ${jobName}:`, err);
  }
}

export async function getCronHealth() {
  try {
    const recentLogs = await prisma.cronExecutionLog.findMany({
      orderBy: { startedAt: 'desc' },
      take: 10,
    });

    const jobStats = await prisma.cronExecutionLog.groupBy({
      by: ['jobName', 'status'],
      _count: { status: true },
      where: {
        startedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    });

    return {
      recentExecutions: recentLogs.map((log) => ({
        jobName: log.jobName,
        status: log.status,
        startedAt: log.startedAt,
        finishedAt: log.finishedAt,
        error: log.error,
      })),
      jobStats,
    };
  } catch (err) {
    return { error: 'Failed to fetch cron health', recentExecutions: [], jobStats: [] };
  }
}
