// scripts/admin/fetch-puct-reps.mjs
// Fetches PUCT REP directory and outputs to CSV

import axios from 'axios';
import { createObjectCsvWriter } from 'csv-writer';
import * as cheerio from 'cheerio';
import path from 'path';

async function fetchReps() {
  const url = 'https://www.puc.texas.gov/industry/electric/directories/rep/alpha_rep/Default.aspx';
  
  console.log(`Fetching REP directory from: ${url}`);
  const resp = await axios.get(url, {
    headers: {
      'User-Agent': 'IntelliWattBot/1.0 (+https://intelliwatt.com)',
    },
    httpsAgent: new (await import('https')).Agent({
      rejectUnauthorized: false, // Allow self-signed certificates
    }),
  });
  
  const html = resp.data;
  const $ = cheerio.load(html);
  
  const records = [];
  
  // Look for table rows that contain REP information
  // PUCT numbers are typically 4+ digits
  $('table tr').each((_, row) => {
    const $row = $(row);
    const text = $row.text().trim();
    
    // Look for PUCT number pattern (4+ digits)
    const puctMatch = text.match(/(\d{4,})/);
    if (!puctMatch) return;
    
    const puctId = puctMatch[1];
    
    // Extract company name - usually after the PUCT number
    // Try to find links or text that looks like a company name
    const links = $row.find('a');
    let name = '';
    
    if (links.length > 0) {
      // If there are links, the company name is likely in one of them
      links.each((_, link) => {
        const linkText = $(link).text().trim();
        // Skip if it's just the PUCT number or navigation text
        if (linkText && linkText !== puctId && !linkText.match(/^(Home|Industry|Electricity|Directories)$/i)) {
          name = linkText;
          return false; // break
        }
      });
    }
    
    // If no name from links, try extracting from row text
    if (!name) {
      const parts = text.split(/\s+/);
      const puctIndex = parts.findIndex(p => p === puctId);
      if (puctIndex >= 0 && puctIndex < parts.length - 1) {
        // Take text after PUCT number
        name = parts.slice(puctIndex + 1).join(' ').trim();
        // Clean up common suffixes
        name = name.replace(/\s*(LLC|INC|CORP|LTD|LP|LLP).*$/i, ' $1').trim();
      }
    }
    
    // Clean up name
    name = name.replace(/\s+/g, ' ').trim();
    
    // Only add if we have a valid name (at least 3 characters)
    if (name.length >= 3) {
      records.push({
        puct_id: puctId,
        name: name,
        contacted: '',
        contact_email: '',
        api_feed_agreed: ''
      });
    }
  });
  
  // Also try looking for links with PUCT numbers directly
  $('a').each((_, link) => {
    const $link = $(link);
    const text = $link.text().trim();
    const puctMatch = text.match(/^(\d{4,})\s+(.+)$/);
    
    if (puctMatch) {
      const puctId = puctMatch[1];
      const name = puctMatch[2].trim();
      
      // Check if we already have this PUCT ID
      if (!records.find(r => r.puct_id === puctId) && name.length >= 3) {
        records.push({
          puct_id: puctId,
          name: name,
          contacted: '',
          contact_email: '',
          api_feed_agreed: ''
        });
      }
    }
  });
  
  // Remove duplicates based on puct_id
  const uniqueRecords = Array.from(
    new Map(records.map(r => [r.puct_id, r])).values()
  );
  
  console.log(`Extracted ${uniqueRecords.length} unique REP records`);
  
  return uniqueRecords;
}

(async () => {
  try {
    const records = await fetchReps();
    
    if (records.length === 0) {
      console.error('No REP records found. The page structure may have changed.');
      process.exit(1);
    }
    
    const outputPath = path.join(process.cwd(), 'texas_reps_directory.csv');
    
    const csvWriter = createObjectCsvWriter({
      path: outputPath,
      header: [
        { id: 'puct_id', title: 'PUCT_ID' },
        { id: 'name', title: 'Name' },
        { id: 'contacted', title: 'Contacted (Y/N)' },
        { id: 'contact_email', title: 'Contact Email' },
        { id: 'api_feed_agreed', title: 'API/Feed Agreement (Y/N)' }
      ]
    });
    
    await csvWriter.writeRecords(records);
    
    console.log(`✅ Wrote ${records.length} REPs to ${outputPath}`);
    console.log(`\nSample records:`);
    records.slice(0, 5).forEach(r => {
      console.log(`  ${r.puct_id}: ${r.name}`);
    });
  } catch (error) {
    console.error('Error fetching REP directory:', error.message);
    if (error.response) {
      console.error(`HTTP ${error.response.status}: ${error.response.statusText}`);
    }
    process.exit(1);
  }
})();

