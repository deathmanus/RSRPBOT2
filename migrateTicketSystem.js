const fs = require('fs');
const path = require('path');
const { initTicketConfig, setTicketConfig, getTicketConfig, db, addTicket } = require('./src/Database/database');

// Funkce pro kontrolu, zda jsou všechny potřebné adresáře připraveny
async function setupTicketSystem() {
    console.log('Začínám migraci ticket systému do databáze...');
    
    try {
        // Načtení konfigurace z databáze
        const existingConfig = await new Promise((resolve, reject) => {
            getTicketConfig((err, config) => {
                if (err) reject(err);
                else resolve(config);
            });
        });
        
        // Pokud konfigurace existuje, zeptáme se, zda ji chceme přepsat
        if (existingConfig) {
            console.log('Konfigurace ticket systému již existuje v databázi.');
            console.log('Aktuální konfigurace obsahuje:');
            console.log(`- ${existingConfig.categories.length} kategorií`);
            console.log('Chcete ji přepsat? (y/n)');
            
            // Zde by normálně byl interaktivní vstup, ale pro automatizaci vždy provedeme aktualizaci
            console.log('Automatické pokračování: ano');
        }
        
        // Inicializace konfigurace (načte z původního souboru, pokud existuje)
        await initTicketConfig();
        console.log('Konfigurace ticket systému byla úspěšně migrována do databáze.');

        // Vytvoření adresářové struktury pro tickety
        console.log('Vytvářím potřebné adresáře...');
        
        const ticketDir = path.join(__dirname, 'src/files/TicketSystem');
        const imagesDir = path.join(ticketDir, 'images');
        
        if (!fs.existsSync(ticketDir)) {
            fs.mkdirSync(ticketDir, { recursive: true });
            console.log(`Vytvořen adresář: ${ticketDir}`);
        }
        
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
            console.log(`Vytvořen adresář: ${imagesDir}`);
        }
        
        // Zkopírování obrázků ze starého umístění do nového
        const oldImagesDir = path.join(__dirname, 'src/files old DO NOT USE/TicketSystem/images');
        if (fs.existsSync(oldImagesDir)) {
            const imageFiles = fs.readdirSync(oldImagesDir);
            
            for (const file of imageFiles) {
                const sourcePath = path.join(oldImagesDir, file);
                const destPath = path.join(imagesDir, file);
                
                // Kontrola, zda soubor již existuje
                if (!fs.existsSync(destPath)) {
                    fs.copyFileSync(sourcePath, destPath);
                    console.log(`Zkopírován soubor: ${file}`);
                } else {
                    console.log(`Soubor již existuje, přeskakuji: ${file}`);
                }
            }
        } else {
            console.log('Starý adresář s obrázky nebyl nalezen.');
        }
        
        // Migrace existujících ticketů do databáze
        console.log('Hledám existující tickety k migraci...');
        const oldTicketsDir = path.join(__dirname, 'src/files old DO NOT USE/TicketSystem/tickets');
        
        if (fs.existsSync(oldTicketsDir)) {
            const ticketFiles = fs.readdirSync(oldTicketsDir).filter(file => file.endsWith('.json'));
            console.log(`Nalezeno ${ticketFiles.length} souborů ticketů.`);
            
            let migratedCount = 0;
            
            for (const file of ticketFiles) {
                try {
                    const ticketPath = path.join(oldTicketsDir, file);
                    const ticketData = JSON.parse(fs.readFileSync(ticketPath, 'utf8'));
                    
                    // Extrahujeme userId ze souboru nebo názvu souboru
                    const userId = ticketData.userId || file.replace('.json', '');
                    
                    // Migrace do databáze
                    await new Promise((resolve, reject) => {
                        addTicket(
                            userId,
                            ticketData.status || 'archived',
                            JSON.stringify(ticketData.config || {}),
                            (err) => {
                                if (err) {
                                    console.error(`Chyba při migraci ticketu ${file}:`, err);
                                    reject(err);
                                } else {
                                    console.log(`Ticket ${file} úspěšně migrován.`);
                                    migratedCount++;
                                    resolve();
                                }
                            }
                        );
                    });
                } catch (error) {
                    console.error(`Chyba při zpracování souboru ${file}:`, error);
                }
            }
            
            console.log(`Úspěšně migrováno ${migratedCount} z ${ticketFiles.length} ticketů.`);
        } else {
            console.log('Žádné existující tickety k migraci nebyly nalezeny.');
        }
        
        console.log('Migrace ticket systému byla úspěšně dokončena!');
        
    } catch (error) {
        console.error('Chyba při migraci ticket systému:', error);
    }
}

// Spuštění migrace
setupTicketSystem().then(() => {
    console.log('Skript dokončen.');
    process.exit(0);
}).catch(err => {
    console.error('Skript selhal:', err);
    process.exit(1);
});
