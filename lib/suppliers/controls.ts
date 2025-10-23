import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'
import { flagBool } from '@/lib/flags'

const prisma = new PrismaClient()

export type SupplierGateInput = {
  supplierName: string
  userKey?: string // a session/user hash if available; else we'll hash a stable anon string
}

export type SupplierControlRow = {
  supplierName: string
  isBlocked: boolean
  rolloutPercent?: number | null
  notes?: string | null
}

export async function listSupplierControls(): Promise<SupplierControlRow[]> {
  const rows = await prisma.supplierControl.findMany({ orderBy: { supplierName: 'asc' } })
  return rows as SupplierControlRow[]
}

export async function upsertSupplierControl(input: SupplierControlRow) {
  const key = input.supplierName.trim()
  
  const existing = await prisma.supplierControl.findFirst({
    where: { supplierName: key }
  })
  
  if (existing) {
    await prisma.supplierControl.update({
      where: { id: existing.id },
      data: { isBlocked: input.isBlocked, rolloutPercent: input.rolloutPercent ?? null, notes: input.notes ?? null }
    })
  } else {
    await prisma.supplierControl.create({
      data: { supplierName: key, isBlocked: input.isBlocked, rolloutPercent: input.rolloutPercent ?? null, notes: input.notes ?? null }
    })
  }
}

function hashKey(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex')
}

/**
 * Determine if a supplier should be visible to a given userKey under current controls.
 * - Blocked → false
 * - If rolloutPercent set, hash(userKey|supplier) into 0..99 bucket and compare
 * - Otherwise → true
 */
export async function allowSupplier({ supplierName, userKey }: SupplierGateInput): Promise<boolean> {
  const apply = await flagBool('recos.applySupplierControls', true)
  if (!apply) return true

  const control = await prisma.supplierControl.findFirst({
    where: { supplierName: { equals: supplierName, mode: 'insensitive' } }
  })
  if (!control) return true
  if (control.isBlocked) return false
  if (control.rolloutPercent == null) return true

  const seed = (userKey || 'anon') + '|' + supplierName.toLowerCase()
  const h = hashKey(seed)
  // Take first two hex chars → 0..255, scale to 0..99
  const bucket = Math.floor((parseInt(h.slice(0, 2), 16) / 255) * 100)
  return bucket < Math.max(0, Math.min(100, control.rolloutPercent))
}
