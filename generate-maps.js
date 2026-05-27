const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const MAPS_DIR = path.join(__dirname, 'public', 'maps');
const WEBP_DIR = path.join(MAPS_DIR, 'webp');
const OUTPUT_FILE = path.join(__dirname, 'public', 'maps.json');

// Check if maps directory exists
if (!fs.existsSync(MAPS_DIR)) {
  console.error(`Error: Maps directory not found at ${MAPS_DIR}`);
  process.exit(1);
}

// Ensure webp directory exists
if (!fs.existsSync(WEBP_DIR)) {
  fs.mkdirSync(WEBP_DIR, { recursive: true });
}

// Function to generate a clean presentation title from a filename
function cleanTitle(filename) {
  // Remove extension
  let name = path.parse(filename).name;

  // Replace common characters with space
  name = name.replace(/[_-]/g, ' ');

  // Add spacing around # symbol if needed
  name = name.replace(/#/g, ' #');

  // Capitalize words
  name = name.replace(/\b\w/g, (char) => char.toUpperCase());

  // Clean up double spaces or trailing spaces
  name = name.replace(/\s+/g, ' ').trim();

  // Specialized overrides for known files to make them look absolutely perfect
  const overrides = {
    'Countries Chess Opening V1mobile': 'Countries Chess Openings (Mobile)',
    'Countries Chess Opening V2desktop': 'Countries Chess Openings (Desktop)',
    'Europe Pop23 3x': 'Europe Population 2023 (High Res)',
    'Europe Pop23 M': 'Europe Population 2023 (Mobile)',
    'Fide Rated Chess Players': 'FIDE Rated Chess Players Map',
    'Heat Related Mortality Linkedin 3x': 'Heat-Related Mortality (LinkedIn 3x)',
    'Isochrone Astana': 'Astana Isochrone Map',
    'World Nomad Games 2024 Results': 'World Nomad Games 2024 - Results',
    'When The Earth Burns Dark': 'When the Earth Burns (Dark)',
    'When The Earth Burns Light': 'When the Earth Burns (Light)',
    'Horror In Gulag': 'Horror in Gulag Map'
  };

  return overrides[name] || name;
}

// Format byte size to a human-readable MB string
function formatSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

async function generateMaps() {
  try {
    const files = fs.readdirSync(MAPS_DIR);
    const maps = [];

    for (const file of files) {
      const filePath = path.join(MAPS_DIR, file);
      const stat = fs.statSync(filePath);

      if (stat.isFile()) {
        const ext = path.extname(file).toLowerCase();
        // Only process PNG, JPG, and JPEG as high-resolution sources
        if (['.png', '.jpg', '.jpeg'].includes(ext)) {
          // Look for a matching WebP file inside public/maps/webp/
          const webpName = path.parse(file).name + '.webp';
          const webpPath = path.join(WEBP_DIR, webpName);
          let hasWebp = fs.existsSync(webpPath);
          
          if (!hasWebp) {
            console.log(`Generating compressed thumbnail for ${file}...`);
            await sharp(filePath)
              .resize({ width: 500, withoutEnlargement: true })
              .webp({ quality: 80 })
              .toFile(webpPath);
            hasWebp = true;
          }
          
          maps.push({
            filename: file,
            title: cleanTitle(file),
            type: ext.substring(1), // 'png', 'jpg', etc.
            size: stat.size,
            sizeFormatted: formatSize(stat.size),
            dateAdded: stat.mtime.toISOString(),
            url: `/maps/${encodeURIComponent(file)}`,
            // Use the WebP as the gallery thumbnail, fallback to original high-res if missing
            thumbnailUrl: hasWebp ? `/maps/webp/${encodeURIComponent(webpName)}` : `/maps/${encodeURIComponent(file)}`
          });
        }
      }
    }

    // Sort by date added (newest first) by default
    maps.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(maps, null, 2), 'utf8');
    console.log(`Successfully compiled map catalog! Saved ${maps.length} maps to ${OUTPUT_FILE}`);
  } catch (error) {
    console.error('Error generating map catalog:', error);
    process.exit(1);
  }
}

generateMaps();
