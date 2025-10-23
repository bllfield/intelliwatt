import { RateModel } from './types'

/**
 * Parse raw EFL text into a RateModel JSON.
 * Assumes text already extracted from PDF.
 */
export function parseEflText(rawText: string): RateModel {
  const text = rawText.replace(/\s+/g, ' ').toLowerCase()
  const notes: string[] = []

  // Term detection
  const termMatch = text.match(/term.*?(\d+)\s*month/)
  const termMonths = termMatch ? parseInt(termMatch[1], 10) : 0

  // Base fee
  let baseFeeCents: number | undefined
  const baseFeeMatch = text.match(/base\s+charge.*?\$?(\d+(\.\d+)?)/)
  if (baseFeeMatch) {
    baseFeeCents = Math.round(parseFloat(baseFeeMatch[1]) * 100)
  }

  // Energy charge tiers
  const energyCharges: RateModel['energyCharges'] = []
  const tierRegex = /(\d+)\s*-\s*(\d+)\s*kwh.*?(\d+(\.\d+)?)\s*¢/g
  let tierMatch
  while ((tierMatch = tierRegex.exec(text)) !== null) {
    energyCharges.push({
      fromKwh: parseInt(tierMatch[1], 10),
      toKwh: parseInt(tierMatch[2], 10),
      rateCents: Math.round(parseFloat(tierMatch[3]) * 100) / 100
    })
  }

  // Flat rate detection
  if (energyCharges.length === 0) {
    const flatMatch = text.match(/energy\s+charge.*?(\d+(\.\d+)?)\s*¢/)
    if (flatMatch) {
      energyCharges.push({
        fromKwh: 0,
        rateCents: Math.round(parseFloat(flatMatch[1]) * 100) / 100
      })
    }
  }

  // Bill credits
  const billCredits: RateModel['billCredits'] = []
  const creditRegex = /credit.*?(\d+)\s*kwh.*?\$?(\d+(\.\d+)?)/g
  let creditMatch
  while ((creditMatch = creditRegex.exec(text)) !== null) {
    billCredits.push({
      thresholdKwh: parseInt(creditMatch[1], 10),
      creditCents: Math.round(parseFloat(creditMatch[2]) * 100)
    })
  }

  // Minimum usage fee
  let minUsageFeeCents: number | undefined
  const minFeeMatch = text.match(/minimum\s+usage.*?\$?(\d+(\.\d+)?)/)
  if (minFeeMatch) {
    minUsageFeeCents = Math.round(parseFloat(minFeeMatch[1]) * 100)
  }

  // Type detection
  let type: RateModel['type'] = 'unknown'
  if (energyCharges.length === 1 && !billCredits.length) type = 'flat'
  else if (energyCharges.length > 1) type = 'tiered'
  if (/time of use|tou|peak|off-peak/.test(text)) type = 'tou'

  return {
    type,
    termMonths,
    baseFeeCents,
    energyCharges,
    billCredits: billCredits.length ? billCredits : undefined,
    minUsageFeeCents,
    notes: notes.length ? notes : undefined
  }
}
