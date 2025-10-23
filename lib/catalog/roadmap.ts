import { modulesCatalog } from './modules'

export type RoadmapBatch = {
  id: number
  name: string
  description: string
  modules: number[]       // IDs from modulesCatalog
  dependencies?: number[] // IDs of batches that must complete first
  estDuration: string
}

export const roadmap: RoadmapBatch[] = [
  {
    id: 1,
    name: 'Core Data Infrastructure',
    description: 'DB schema, ingestion, normalization, and rate model parsing',
    modules: [62, 63, 64, 65, 66, 67],
    estDuration: '5–6 days'
  },
  {
    id: 2,
    name: 'Computation & APIs',
    description: 'Billing engine, recommendation engine, and compliance layers',
    modules: [68, 69, 70, 71],
    dependencies: [1],
    estDuration: '4–5 days'
  },
  {
    id: 3,
    name: 'Auditability & Controls',
    description: 'Observability, feature flags, supplier controls, and fallback UI',
    modules: [72, 73],
    dependencies: [2],
    estDuration: '3 days'
  },
  {
    id: 4,
    name: 'Admin & Documentation',
    description: 'Module catalog, roadmap display, admin dashboards',
    modules: [74],
    dependencies: [1, 2, 3],
    estDuration: '1–2 days'
  },
  {
    id: 5,
    name: 'Upcoming Enhancements',
    description: 'Billing UI, enrollment workflow, performance metrics, and payout reconciliation',
    modules: [],
    dependencies: [3, 4],
    estDuration: 'Next phase (TBD)'
  }
]

/** Utility to resolve batch details by module ID */
export function findBatchForModule(id: number) {
  return roadmap.find(b => b.modules.includes(id))
}

/** Convenience: attach batch metadata to each module for admin display */
export function modulesWithBatches() {
  return modulesCatalog.map(m => ({
    ...m,
    batch: findBatchForModule(m.id)?.name || 'Unassigned'
  }))
}
