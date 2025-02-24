const fs = require('fs');
const path = require('path');

class ConfigSystem {
    static configDir = path.join(__dirname, '../files/config');
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
        if (!fs.existsSync(this.configDir)) {
            fs.mkdirSync(this.configDir, { recursive: true });
        }

        // Initialize default configs if they don't exist
        for (const [key, value] of Object.entries(this.defaults)) {
            const configPath = path.join(this.configDir, `${key}.json`);
            if (!fs.existsSync(configPath)) {
                fs.writeFileSync(configPath, JSON.stringify(value, null, 2));
            }
        }
    }

    static get(section) {
        if (this.cache.has(section)) {
            return this.cache.get(section);
        }

        const configPath = path.join(this.configDir, `${section}.json`);
        if (!fs.existsSync(configPath)) {
            // If config doesn't exist, create it with defaults
            if (this.defaults[section]) {
                fs.writeFileSync(configPath, JSON.stringify(this.defaults[section], null, 2));
                this.cache.set(section, this.defaults[section]);
                return this.defaults[section];
            }
            throw new Error(`Configuration section '${section}' not found`);
        }

        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        this.cache.set(section, config);
        return config;
    }

    static set(section, key, value) {
        const config = this.get(section);
        const keys = key.split('.');
        let current = config;

        for (let i = 0; i < keys.length - 1; i++) {
            if (!(keys[i] in current)) {
                current[keys[i]] = {};
            }
            current = current[keys[i]];
        }

        current[keys[keys.length - 1]] = value;
        
        const configPath = path.join(this.configDir, `${section}.json`);
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        this.cache.set(section, config);
        
        return config;
    }

    static clearCache() {
        this.cache.clear();
    }
}

module.exports = ConfigSystem;