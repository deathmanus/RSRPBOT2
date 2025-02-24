const { scheduleJob } = require('node-schedule');
const fs = require('fs');
const path = require('path');
const { getEmoji } = require('../utils/emojiUtils');
const ConfigSystem = require('./configSystem');

const INCOME_FILE = path.join(__dirname, '../files/Income/income-config.json');
const LAST_RUN_FILE = path.join(__dirname, '../files/Income/last-run.json');
const HISTORY_DIR = path.join(__dirname, '../files/Income/history');

// Default configurations
const defaultIncomeConfig = {
    roles: [
        {
            roleId: "1234567890123456789",
            dailyIncome: 1000,
            description: "Example Income Role"
        }
    ]
};

const defaultLastRun = {
    lastIncomeDate: new Date().toISOString()
};

class IncomeSystem {
    constructor(client) {
        this.client = client;
        this.ensureFiles();
        this.setupIncomeJob();
    }

    ensureFiles() {
        // Create directories if they don't exist
        const dirs = [
            path.dirname(INCOME_FILE),
            HISTORY_DIR
        ];
        
        dirs.forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });

        if (!fs.existsSync(INCOME_FILE)) {
            fs.writeFileSync(INCOME_FILE, JSON.stringify(defaultIncomeConfig, null, 2));
        }

        if (!fs.existsSync(LAST_RUN_FILE)) {
            fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(defaultLastRun, null, 2));
        }
    }

    setupIncomeJob() {
        const config = ConfigSystem.get('income');
        scheduleJob(config.paymentTime, () => this.distributeIncome());
        this.checkMissedPayments();
        this.cleanupOldHistory();
    }

    async checkMissedPayments() {
        try {
            const lastRun = JSON.parse(fs.readFileSync(LAST_RUN_FILE, 'utf8'));
            const lastRunDate = new Date(lastRun.lastIncomeDate);
            const now = new Date();
            
            const diffTime = Math.abs(now - lastRunDate);
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays > 0) {
                console.log(`${getEmoji('clock')} Found ${diffDays} missed days. Adding income...`);
                await this.distributeIncome(diffDays);
            }
        } catch (error) {
            console.error(`${getEmoji('error')} Error checking missed payments:`, error);
        }
    }

    cleanupOldHistory() {
        try {
            const config = ConfigSystem.get('income');
            const retentionDays = config.historyRetention;
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

            const files = fs.readdirSync(HISTORY_DIR);
            for (const file of files) {
                const filePath = path.join(HISTORY_DIR, file);
                const fileDate = new Date(file.split('.')[0]);
                if (fileDate < cutoffDate) {
                    fs.unlinkSync(filePath);
                }
            }
        } catch (error) {
            console.error(`${getEmoji('error')} Error cleaning up history:`, error);
        }
    }

    async distributeIncome(multiplier = 1) {
        try {
            console.log(`${getEmoji('money')} Starting income distribution...`);
            
            let attempts = 0;
            while (!this.client.isReady() && attempts < 10) {
                console.log(`⏳ Waiting for client (${attempts + 1}/10)...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                attempts++;
            }

            if (!this.client.isReady()) {
                throw new Error('Client failed to become ready');
            }

            const config = JSON.parse(fs.readFileSync(INCOME_FILE, 'utf8'));
            const fractionsDir = path.join(__dirname, '../files/Fractions');
            const guild = this.client.guilds.cache.get('1213225813844037734');

            if (!guild) {
                throw new Error('Guild not found');
            }

            // Get all fractions
            const fractions = fs.readdirSync(fractionsDir)
                .filter(f => fs.statSync(path.join(fractionsDir, f)).isDirectory());

            console.log(`${getEmoji('folder')} Processing ${fractions.length} fractions...`);

            // Create history entry
            const historyEntry = {
                timestamp: new Date().toISOString(),
                distributions: []
            };

            // Force fetch all guild members first
            await guild.members.fetch();

            for (const fraction of fractions) {
                try {
                    const fractionFile = path.join(fractionsDir, fraction, `${fraction}.json`);
                    if (!fs.existsSync(fractionFile)) {
                        console.log(`${getEmoji('error')} No config for fraction: ${fraction}`);
                        continue;
                    }

                    const fractionData = JSON.parse(fs.readFileSync(fractionFile, 'utf8'));
                    
                    const fractionRole = await guild.roles.fetch(fractionData.fractionRoleId);
                    if (!fractionRole) {
                        console.log(`${getEmoji('error')} Role not found: ${fractionData.fractionRoleId}`);
                        continue;
                    }

                    const fractionMembers = fractionRole.members;
                    if (!fractionMembers || fractionMembers.size === 0) {
                        console.log(`${getEmoji('error')} No members found in fraction: ${fraction}`);
                        continue;
                    }

                    console.log(`${getEmoji('members')} Processing ${fractionMembers.size} members in ${fraction}`);
                    
                    let totalIncome = 0;
                    const memberIncomes = [];

                    // Check each fraction member for income roles
                    for (const [, member] of fractionMembers) {
                        let memberIncome = 0;
                        for (const incomeRole of config.roles) {
                            if (member.roles.cache.has(incomeRole.roleId)) {
                                memberIncome += incomeRole.dailyIncome;
                                console.log(`${getEmoji('money')} ${member.user.tag} +${incomeRole.dailyIncome}`);
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
                        fractionData.money = (fractionData.money || 0) + finalIncome;
                        fs.writeFileSync(fractionFile, JSON.stringify(fractionData, null, 2));

                        // Add to history
                        historyEntry.distributions.push({
                            fraction,
                            totalIncome: finalIncome,
                            memberIncomes
                        });

                        console.log(`${getEmoji('success')} Added ${finalIncome} to ${fraction}`);
                    }
                } catch (fractionError) {
                    console.error(`${getEmoji('error')} Error processing ${fraction}:`, fractionError);
                }
            }

            // Save history
            const historyFile = path.join(HISTORY_DIR, `${new Date().toISOString().split('T')[0]}.json`);
            fs.writeFileSync(historyFile, JSON.stringify(historyEntry, null, 2));

            // Update last run time
            fs.writeFileSync(LAST_RUN_FILE, JSON.stringify({
                lastIncomeDate: new Date().toISOString()
            }, null, 2));

            console.log(`${getEmoji('success')} Income distribution completed`);

        } catch (error) {
            console.error(`${getEmoji('error')} Fatal error:`, error);
        }
    }

    static getHistory(days = 7) {
        try {
            const files = fs.readdirSync(HISTORY_DIR)
                .filter(f => f.endsWith('.json'))
                .sort((a, b) => {
                    const dateA = new Date(a.split('.')[0]);
                    const dateB = new Date(b.split('.')[0]);
                    return dateB - dateA;
                })
                .slice(0, days);

            return files.map(file => {
                const filePath = path.join(HISTORY_DIR, file);
                return JSON.parse(fs.readFileSync(filePath, 'utf8'));
            });
        } catch (error) {
            console.error(`${getEmoji('error')} Error reading income history:`, error);
            return [];
        }
    }
}

module.exports = IncomeSystem;