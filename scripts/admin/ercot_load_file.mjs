import 'dotenv/config'
// Note: This script should use the API endpoint instead for consistency
// For direct file loading, use: npm run ercot:fetch:latest with ERCOT_TEST_URL set
const file = process.argv[2]
if (!file) {
  console.error('Usage: node scripts/admin/ercot_load_file.mjs <file-path>')
  console.error('Note: For production, use the API endpoint:')
  console.error('  npm run ercot:fetch:latest (with ERCOT_TEST_URL set)')
  process.exit(1)
}
console.error('Direct file loading not implemented. Use API endpoint instead.')
console.error('Set ERCOT_TEST_URL and run: npm run ercot:fetch:latest')
process.exit(1)

