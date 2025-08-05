const fs = require('fs');
const path = require('path');
const { db, addShopLog } = require('./src/Database/database');

// Cesta k souboru s logy
const logFilePath = path.join(__dirname, 'src/files/logs/shop.log');

async function migrateShopLogs() {
    console.log('Začínám migraci logů obchodu do databáze...');
    
    // Kontrola, zda soubor existuje
    if (!fs.existsSync(logFilePath)) {
        console.log('Soubor s logy neexistuje, nic k migraci.');
        return;
    }
    
    try {
        // Načtení logů ze souboru
        const fileContent = fs.readFileSync(logFilePath, 'utf8');
        const logLines = fileContent.split('\n').filter(line => line.trim());
        
        console.log(`Načteno ${logLines.length} záznamů z logovacího souboru.`);
        
        // Zpracování a import každého logu
        let importedCount = 0;
        let errorCount = 0;
        
        for (const line of logLines) {
            try {
                const logEntry = JSON.parse(line);
                
                // Import do databáze
                await addShopLog(logEntry.action, logEntry.data);
                importedCount++;
                
                // Výpis pokroku po každých 100 záznamech
                if (importedCount % 100 === 0) {
                    console.log(`Zpracováno ${importedCount} záznamů...`);
                }
            } catch (err) {
                console.error('Chyba při importu logu:', err);
                errorCount++;
            }
        }
        
        console.log(`Migrace dokončena!`);
        console.log(`Úspěšně importováno: ${importedCount} záznamů`);
        
        if (errorCount > 0) {
            console.log(`Chyby při importu: ${errorCount} záznamů`);
        }
        
        // Vytvoření zálohy původního souboru
        const backupPath = `${logFilePath}.backup-${Date.now()}`;
        fs.copyFileSync(logFilePath, backupPath);
        console.log(`Vytvořena záloha původního souboru: ${backupPath}`);
        
        // Volitelně: vyčištění původního souboru
        // fs.writeFileSync(logFilePath, '', 'utf8');
        // console.log('Původní soubor s logy byl vyčištěn.');
        
    } catch (error) {
        console.error('Nastala chyba při migraci logů:', error);
    }
}

// Spuštění migrace
migrateShopLogs().then(() => {
    console.log('Skript dokončen.');
    process.exit(0);
}).catch(err => {
    console.error('Skript selhal:', err);
    process.exit(1);
});
