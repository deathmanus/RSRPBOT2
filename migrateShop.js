const fs = require('fs');
const path = require('path');
const { 
    addShopSection, 
    addShopItem,
    db
} = require('./src/Database/database');

// Paths
const shopDir = path.join(__dirname, 'src/files old DO NOT USE/Shop');

// Helper function to execute queries in sequence
function runQuery(query, params = []) {
    return new Promise((resolve, reject) => {
        db.run(query, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

// Migrate shop sections and items
async function migrateShop() {
    try {
        console.log('Starting shop migration...');
        
        // Get all shop sections
        const sections = fs.readdirSync(shopDir, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);
        
        console.log(`Found ${sections.length} sections: ${sections.join(', ')}`);
        
        // Add sections to database and collect items
        let totalItems = 0;
        
        for (const section of sections) {
            // Add section to database
            await runQuery('INSERT OR IGNORE INTO shop_sections (name) VALUES (?)', [section]);
            console.log(`Added section: ${section}`);
            
            // Get section ID
            const sectionResult = await new Promise((resolve, reject) => {
                db.get('SELECT id FROM shop_sections WHERE name = ?', [section], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            
            const sectionId = sectionResult.id;
            
            // Get all items in this section
            const sectionPath = path.join(shopDir, section);
            const items = fs.readdirSync(sectionPath)
                .filter(file => file.endsWith('.json'));
            
            console.log(`Found ${items.length} items in section ${section}`);
            totalItems += items.length;
            
            // Add each item to the database
            for (const itemFile of items) {
                const itemPath = path.join(sectionPath, itemFile);
                const itemData = JSON.parse(fs.readFileSync(itemPath, 'utf8'));
                
                // Prepare item data for database
                await runQuery(
                    `INSERT INTO shop_items (
                        section_id, name, type, base_price, 
                        max_count, min_count, modifications, description
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        sectionId,
                        itemData.name,
                        itemData.type,
                        itemData.basePrice,
                        itemData.maxCount || null,
                        itemData.minCount || null,
                        itemData.modifications ? JSON.stringify(itemData.modifications) : null,
                        itemData.description || null
                    ]
                );
                
                console.log(`Added item: ${itemData.name}`);
            }
        }
        
        console.log(`Migration completed successfully!`);
        console.log(`Total: ${sections.length} sections, ${totalItems} items`);
        
    } catch (error) {
        console.error('Error during migration:', error);
    }
}

// Run the migration
migrateShop().then(() => {
    console.log('Migration process finished.');
});
