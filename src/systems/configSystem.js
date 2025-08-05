const { db } = require('../Database/database');

class ConfigSystem {
    static CONFIG_TABLE = 'config';
    static cache = new Map();
    static defaults = {
        shop: {
            cacheTimeout: 5 * 60 * 1000,
            maxItemsPerPage: 25,
            defaultCurrency: 'money'
        },
        income: {
            paymentTime: '0 0 * * *', // Every day at midnight
            defaultCurrency: 'money',
            historyRetention: 30 // days
        },
        fractions: {
            maxWarns: 3,
            warnExpiration: 30 // days
        }
    };

    static initialize() {
        // Vytvoření tabulky config, pokud neexistuje
        db.run(`CREATE TABLE IF NOT EXISTS ${this.CONFIG_TABLE} (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`);

        // Inicializace výchozích konfigurací v databázi
        for (const [key, value] of Object.entries(this.defaults)) {
            db.get(`SELECT value FROM ${this.CONFIG_TABLE} WHERE key = ?`, [key], (err, row) => {
                if (err) {
                    console.error(`Error checking config for ${key}:`, err);
                    return;
                }
                
                if (!row) {
                    // Pokud konfigurace neexistuje, vytvoříme ji s výchozími hodnotami
                    db.run(
                        `INSERT INTO ${this.CONFIG_TABLE} (key, value) VALUES (?, ?)`,
                        [key, JSON.stringify(value)],
                        (err) => {
                            if (err) {
                                console.error(`Error creating default config for ${key}:`, err);
                            } else {
                                console.log(`Created default config for ${key}`);
                            }
                        }
                    );
                }
            });
        }
    }

    static get(section) {
        if (this.cache.has(section)) {
            return this.cache.get(section);
        }

        return new Promise((resolve, reject) => {
            db.get(`SELECT value FROM ${this.CONFIG_TABLE} WHERE key = ?`, [section], (err, row) => {
                if (err) {
                    console.error(`Error reading config for ${section}:`, err);
                    reject(err);
                    return;
                }
                
                if (!row) {
                    // Pokud konfigurace neexistuje, vytvoříme ji s výchozími hodnotami
                    if (this.defaults[section]) {
                        db.run(
                            `INSERT INTO ${this.CONFIG_TABLE} (key, value) VALUES (?, ?)`,
                            [section, JSON.stringify(this.defaults[section])],
                            (insertErr) => {
                                if (insertErr) {
                                    console.error(`Error creating default config for ${section}:`, insertErr);
                                    reject(insertErr);
                                } else {
                                    this.cache.set(section, this.defaults[section]);
                                    resolve(this.defaults[section]);
                                }
                            }
                        );
                    } else {
                        const error = new Error(`Configuration section '${section}' not found`);
                        reject(error);
                    }
                } else {
                    try {
                        const config = JSON.parse(row.value);
                        this.cache.set(section, config);
                        resolve(config);
                    } catch (parseErr) {
                        console.error(`Error parsing config for ${section}:`, parseErr);
                        reject(parseErr);
                    }
                }
            });
        });
    }

    // Synchronní verze get pro zpětnou kompatibilitu
    static getSync(section) {
        if (this.cache.has(section)) {
            return this.cache.get(section);
        }

        try {
            const config = this.defaults[section] || {};
            console.warn(`Using default config for ${section} in sync mode`);
            this.cache.set(section, config);
            return config;
        } catch (error) {
            console.error(`Error in getSync for ${section}:`, error);
            throw new Error(`Configuration section '${section}' not found`);
        }
    }

    static set(section, key, value) {
        return new Promise((resolve, reject) => {
            this.get(section)
                .then(config => {
                    const keys = key.split('.');
                    let current = config;

                    for (let i = 0; i < keys.length - 1; i++) {
                        if (!(keys[i] in current)) {
                            current[keys[i]] = {};
                        }
                        current = current[keys[i]];
                    }

                    current[keys[keys.length - 1]] = value;
                    
                    db.run(
                        `UPDATE ${this.CONFIG_TABLE} SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?`,
                        [JSON.stringify(config), section],
                        (err) => {
                            if (err) {
                                console.error(`Error updating config for ${section}:`, err);
                                reject(err);
                            } else {
                                this.cache.set(section, config);
                                resolve(config);
                            }
                        }
                    );
                })
                .catch(reject);
        });
    }

    static clearCache() {
        this.cache.clear();
    }

    // Získá všechny konfigurace
    static getAllConfigs() {
        return new Promise((resolve, reject) => {
            db.all(`SELECT key, value, updated_at FROM ${this.CONFIG_TABLE}`, [], (err, rows) => {
                if (err) {
                    console.error('Error fetching all configs:', err);
                    reject(err);
                    return;
                }
                
                const configs = {};
                rows.forEach(row => {
                    try {
                        configs[row.key] = {
                            data: JSON.parse(row.value),
                            updatedAt: row.updated_at
                        };
                    } catch (parseErr) {
                        console.error(`Error parsing config for ${row.key}:`, parseErr);
                    }
                });
                
                resolve(configs);
            });
        });
    }
}

// Inicializace na začátku
ConfigSystem.initialize();

module.exports = ConfigSystem;