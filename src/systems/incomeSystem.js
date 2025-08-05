const { scheduleJob } = require('node-schedule');
const { getEmojiSync } = require('../utils/emojiUtils');
const ConfigSystem = require('./configSystem');
const { 
    db, 
    getIncomeRoles, 
    getFractionByName, 
    updateFractionMoney, 
    addIncomeDistribution 
} = require('../Database/database');

// Nastavení pro tabulku config v databázi (bude vytvořena níže)
const CONFIG_TABLE = 'config';
const INCOME_CONFIG_KEY = 'income_last_run';

class IncomeSystem {
    constructor(client) {
        this.client = client;
        this.ensureDatabase();
        this.setupIncomeJob();
    }

    ensureDatabase() {
        // Vytvoření tabulky config, pokud neexistuje
        db.run(`CREATE TABLE IF NOT EXISTS ${CONFIG_TABLE} (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`);
        
        // Kontrola, zda existuje záznam o posledním běhu
        db.get(`SELECT value FROM ${CONFIG_TABLE} WHERE key = ?`, [INCOME_CONFIG_KEY], (err, row) => {
            if (!row) {
                // Pokud záznam neexistuje, vytvoříme ho s aktuálním datem
                db.run(
                    `INSERT INTO ${CONFIG_TABLE} (key, value) VALUES (?, ?)`,
                    [INCOME_CONFIG_KEY, JSON.stringify({ lastIncomeDate: new Date().toISOString() })]
                );
            }
        });
    }

    setupIncomeJob() {
        const config = ConfigSystem.getSync('income');
        scheduleJob(config.paymentTime, () => this.distributeIncome());
        this.checkMissedPayments();
        this.cleanupOldHistory();
    }

    async checkMissedPayments() {
        try {
            const lastRun = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT value FROM ${CONFIG_TABLE} WHERE key = ?`, 
                    [INCOME_CONFIG_KEY], 
                    (err, row) => {
                        if (err) reject(err);
                        else resolve(row ? JSON.parse(row.value) : { lastIncomeDate: new Date().toISOString() });
                    }
                );
            });
            
            const lastRunDate = new Date(lastRun.lastIncomeDate);
            const now = new Date();
            
            const diffTime = Math.abs(now - lastRunDate);
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays > 0) {
                console.log(`${getEmojiSync('clock')} Found ${diffDays} missed days. Adding income...`);
                await this.distributeIncome(diffDays);
            }
        } catch (error) {
            console.error(`${getEmojiSync('error')} Error checking missed payments:`, error);
        }
    }

    cleanupOldHistory() {
        try {
            const config = ConfigSystem.getSync('income');
            const retentionDays = config.historyRetention || 30; // Defaultní hodnota 30 dní
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
            
            // Odstranění starých záznamů v income_history
            db.run(
                `DELETE FROM income_history WHERE distribution_date < ?`,
                [cutoffDate.toISOString()]
            );
            
            console.log(`${getEmojiSync('cleanup')} Cleaned up income history older than ${retentionDays} days`);
        } catch (error) {
            console.error(`${getEmojiSync('error')} Error cleaning up history:`, error);
        }
    }

    async distributeIncome(multiplier = 1) {
        try {
            console.log(`${getEmojiSync('money')} Starting income distribution...`);
            
            let attempts = 0;
            while (!this.client.isReady() && attempts < 10) {
                console.log(`⏳ Waiting for client (${attempts + 1}/10)...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                attempts++;
            }

            if (!this.client.isReady()) {
                throw new Error('Client failed to become ready');
            }

            // Načtení income rolí z databáze
            const incomeRoles = await new Promise((resolve, reject) => {
                getIncomeRoles((err, roles) => {
                    if (err) reject(err);
                    else resolve(roles || []);
                });
            });

            if (incomeRoles.length === 0) {
                console.log(`${getEmojiSync('warning')} No income roles found in database`);
                return;
            }

            // Načtení všech frakcí z databáze
            const fractions = await new Promise((resolve, reject) => {
                db.all(`SELECT * FROM fractions`, [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            });

            if (fractions.length === 0) {
                console.log(`${getEmojiSync('warning')} No fractions found in database`);
                return;
            }

            const guild = this.client.guilds.cache.get('1213225813844037734');

            if (!guild) {
                throw new Error('Guild not found');
            }

            console.log(`${getEmojiSync('folder')} Processing ${fractions.length} fractions...`);
            
            // Historie distribucí pro záznam
            const historyEntries = [];
            const now = new Date();
            const distributionDate = now.toISOString();

            // Force fetch all guild members first
            await guild.members.fetch();

            for (const fraction of fractions) {
                try {
                    const fractionRole = await guild.roles.fetch(fraction.fractionRoleId);
                    if (!fractionRole) {
                        console.log(`${getEmojiSync('error')} Role not found: ${fraction.fractionRoleId}`);
                        continue;
                    }

                    const fractionMembers = fractionRole.members;
                    if (!fractionMembers || fractionMembers.size === 0) {
                        console.log(`${getEmojiSync('error')} No members found in fraction: ${fraction.name}`);
                        continue;
                    }

                    console.log(`${getEmojiSync('members')} Processing ${fractionMembers.size} members in ${fraction.name}`);
                    
                    let totalIncome = 0;
                    const memberIncomes = [];

                    // Check each fraction member for income roles
                    for (const [, member] of fractionMembers) {
                        let memberIncome = 0;
                        for (const incomeRole of incomeRoles) {
                            if (member.roles.cache.has(incomeRole.role_id)) {
                                memberIncome += incomeRole.daily_income;
                                console.log(`${getEmojiSync('money')} ${member.user.tag} +${incomeRole.daily_income}`);
                                
                                // Vytvoření záznamu v income_history
                                addIncomeDistribution(
                                    member.id,
                                    incomeRole.role_id,
                                    incomeRole.daily_income,
                                    distributionDate
                                );
                            }
                        }
                        
                        if (memberIncome > 0) {
                            memberIncomes.push({
                                memberId: member.id,
                                memberTag: member.user.tag,
                                amount: memberIncome
                            });
                            totalIncome += memberIncome;
                        }
                    }

                    if (totalIncome > 0) {
                        const finalIncome = totalIncome * multiplier;
                        
                        // Aktualizace peněz frakce v databázi
                        await updateFractionMoney(fraction.id, finalIncome, true);
                        
                        // Přidání do historie
                        historyEntries.push({
                            fractionId: fraction.id,
                            fractionName: fraction.name,
                            totalIncome: finalIncome,
                            memberCount: memberIncomes.length
                        });

                        console.log(`${getEmojiSync('success')} Added ${finalIncome} to ${fraction.name}`);
                    }
                } catch (fractionError) {
                    console.error(`${getEmojiSync('error')} Error processing ${fraction.name}:`, fractionError);
                }
            }

            // Aktualizace posledního běhu v databázi
            db.run(
                `UPDATE ${CONFIG_TABLE} SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?`,
                [JSON.stringify({ lastIncomeDate: now.toISOString() }), INCOME_CONFIG_KEY]
            );

            console.log(`${getEmojiSync('success')} Income distribution completed (${historyEntries.length} fractions)`);

        } catch (error) {
            console.error(`${getEmojiSync('error')} Fatal error:`, error);
        }
    }

    static getHistory(userId, days = 7) {
        return new Promise((resolve, reject) => {
            const date = new Date();
            date.setDate(date.getDate() - days);
            
            const query = userId 
                ? `SELECT ih.*, ir.role_name, ir.daily_income
                   FROM income_history ih
                   LEFT JOIN income_roles ir ON ih.role_id = ir.role_id
                   WHERE ih.user_id = ? AND ih.distribution_date >= ?
                   ORDER BY ih.distribution_date DESC`
                : `SELECT ih.*, ir.role_name, ir.daily_income
                   FROM income_history ih
                   LEFT JOIN income_roles ir ON ih.role_id = ir.role_id
                   WHERE ih.distribution_date >= ?
                   ORDER BY ih.distribution_date DESC`;
            
            const params = userId ? [userId, date.toISOString()] : [date.toISOString()];
            
            db.all(query, params, (err, rows) => {
                if (err) {
                    console.error(`${getEmojiSync('error')} Error reading income history:`, err);
                    reject(err);
                } else {
                    // Seskupit data podle data distribuce
                    const groupedHistory = {};
                    
                    rows.forEach(row => {
                        const date = row.distribution_date.split('T')[0];
                        if (!groupedHistory[date]) {
                            groupedHistory[date] = {
                                date,
                                distributions: []
                            };
                        }
                        
                        groupedHistory[date].distributions.push({
                            userId: row.user_id,
                            roleId: row.role_id,
                            roleName: row.role_name,
                            amount: row.amount
                        });
                    });
                    
                    resolve(Object.values(groupedHistory));
                }
            });
        });
    }
}

module.exports = IncomeSystem;
