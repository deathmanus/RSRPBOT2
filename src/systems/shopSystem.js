const fs = require('fs');
const path = require('path');
const { db, getShopItems } = require('../Database/database');

// Cache pro data obchodu
let shopCache = {
    sections: {},
    lastUpdate: null,
    cacheTimeout: 5 * 60 * 1000 // 5 minut
};

// Schéma pro validaci položek
const itemSchema = {
    required: ['name', 'basePrice', 'type'],
    types: {
        countable: ['maxCount', 'minCount'],
        modifiable: ['modifications']
    }
};

// Logger pro obchod
class ShopLogger {
    static logFile = path.join(__dirname, '../files/logs/shop.log');

    static ensureLogDirectory() {
        const dir = path.dirname(this.logFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    static log(action, data) {
        this.ensureLogDirectory();
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            action,
            data
        };

        fs.appendFileSync(
            this.logFile,
            JSON.stringify(logEntry) + '\n',
            'utf8'
        );

        // Také vypíšeme do konzole pro debugování
        console.log(`[SHOP ${timestamp}] ${action}:`, data);
    }

    static getRecentLogs(minutes = 60) {
        try {
            if (!fs.existsSync(this.logFile)) return [];
            const logs = fs.readFileSync(this.logFile, 'utf8')
                .split('\n')
                .filter(line => line.trim())
                .map(line => JSON.parse(line));

            const timeThreshold = Date.now() - (minutes * 60 * 1000);
            return logs.filter(log => new Date(log.timestamp) > timeThreshold);
        } catch (error) {
            console.error('Error reading logs:', error);
            return [];
        }
    }
}

class ShopSystem {
    static async loadSection(sectionName) {
        const now = Date.now();
        
        // Kontrola cache
        if (shopCache.sections[sectionName] && 
            (now - shopCache.lastUpdate) < shopCache.cacheTimeout) {
            ShopLogger.log('Cache Hit', { section: sectionName });
            return shopCache.sections[sectionName];
        }

        try {
            // Načtení položek z databáze
            const items = await new Promise((resolve, reject) => {
                getShopItems(sectionName, (err, rows) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    // Zpracování dat z databáze
                    const itemsFormatted = rows.map(item => {
                        // Parse modifications JSON if it exists
                        let modifications = null;
                        if (item.modifications) {
                            try {
                                modifications = JSON.parse(item.modifications);
                            } catch (e) {
                                ShopLogger.log('Error', {
                                    action: 'parseModifications',
                                    itemId: item.id,
                                    error: e.message
                                });
                            }
                        }
                        
                        return {
                            id: item.id,
                            name: item.name,
                            type: item.type,
                            basePrice: item.base_price,
                            maxCount: item.max_count,
                            minCount: item.min_count,
                            modifications: modifications,
                            description: item.description,
                            filename: `${item.id}.json` // Pro kompatibilitu se starým kódem
                        };
                    });
                    
                    resolve(itemsFormatted);
                });
            });

            // Aktualizace cache
            shopCache.sections[sectionName] = items;
            shopCache.lastUpdate = now;
            
            ShopLogger.log('Section Loaded (DB)', { 
                section: sectionName, 
                itemCount: items.length 
            });
            
            return items;
        } catch (error) {
            ShopLogger.log('Error', {
                action: 'loadSection',
                section: sectionName,
                error: error.message
            });
            throw error;
        }
    }

    static validateItem(item) {
        const errors = [];

        // Kontrola povinných polí
        for (const field of itemSchema.required) {
            if (!item[field]) {
                errors.push(`Chybí povinné pole: ${field}`);
            }
        }

        // Kontrola typu položky
        if (item.type && itemSchema.types[item.type]) {
            for (const field of itemSchema.types[item.type]) {
                if (!item[field]) {
                    errors.push(`Chybí pole pro typ ${item.type}: ${field}`);
                }
            }
        }

        // Specifické validace podle typu
        if (item.type === 'countable') {
            if (typeof item.maxCount !== 'number' || item.maxCount <= 0) {
                errors.push('maxCount musí být kladné číslo');
            }
            if (typeof item.minCount !== 'number' || item.minCount < 0) {
                errors.push('minCount musí být nezáporné číslo');
            }
            if (item.minCount > item.maxCount) {
                errors.push('minCount nemůže být větší než maxCount');
            }
        }

        if (item.type === 'modifiable' && item.modifications) {
            for (const [modName, modValues] of Object.entries(item.modifications)) {
                if (!Array.isArray(modValues)) {
                    errors.push(`Modifikace ${modName} musí být pole možností`);
                }
                modValues.forEach((mod, index) => {
                    if (!mod.name) {
                        errors.push(`Chybí název pro možnost ${index} v modifikaci ${modName}`);
                    }
                });
            }
        }

        return errors;
    }

    static clearCache() {
        shopCache = {
            sections: {},
            lastUpdate: null,
            cacheTimeout: shopCache.cacheTimeout
        };
        ShopLogger.log('Cache Cleared', {});
    }

    static updateCacheTimeout(minutes) {
        shopCache.cacheTimeout = minutes * 60 * 1000;
        ShopLogger.log('Cache Timeout Updated', { minutes });
    }
}

module.exports = {
    ShopSystem,
    ShopLogger
};