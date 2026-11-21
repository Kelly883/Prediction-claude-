import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const defaults = require('../lib/analysis/defaults.json');

const prisma = new PrismaClient();

const CONFIG_DESCRIPTIONS = {
  confidence_threshold: 'Minimum confidence percentage for a pick to be generated',
  market_weights: 'Default factor weights for the ten analysis markets',
  data_source_priorities: 'Preferred order of football data providers',
};

async function main() {
  const superadmin = await prisma.user.findFirst({
    where: { role: 'superadmin' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!superadmin) {
    throw new Error('A superadmin user must exist before seeding analysis configuration');
  }

  for (const league of defaults.leagues) {
    await prisma.leagueConfig.upsert({
      where: { leagueCode: league.leagueCode },
      create: {
        leagueName: league.leagueName,
        leagueCode: league.leagueCode,
        isEnabled: true,
        priority: 1,
      },
      update: {
        leagueName: league.leagueName,
        isEnabled: true,
        priority: 1,
      },
    });
  }

  const configValues = {
    confidence_threshold: defaults.threshold,
    market_weights: defaults.marketWeights,
    data_source_priorities: defaults.dataSourcePriorities,
  };

  for (const [key, value] of Object.entries(configValues)) {
    await prisma.analysisConfig.upsert({
      where: { key },
      create: {
        key,
        value,
        description: CONFIG_DESCRIPTIONS[key],
        updatedById: superadmin.id,
      },
      update: {
        value,
        description: CONFIG_DESCRIPTIONS[key],
        updatedById: superadmin.id,
      },
    });
  }

  console.log(`Seeded ${defaults.leagues.length} leagues and ${Object.keys(configValues).length} analysis configs`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
