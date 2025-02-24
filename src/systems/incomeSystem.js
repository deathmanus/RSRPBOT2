const { scheduleJob } = require('node-schedule');
const fs = require('fs');
const path = require('path');
const { getEmoji } = require('../utils/emojiUtils');

const INCOME_FILE = path.join(__dirname, '../files/Income/income-config.json');
const LAST_RUN_FILE = path.join(__dirname, '../files/Income/last-run.json');

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
        // Create directory if it doesn't exist
        const dir = path.dirname(INCOME_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        if (!fs.existsSync(INCOME_FILE)) {
            fs.writeFileSync(INCOME_FILE, JSON.stringify(defaultIncomeConfig, null, 2));
        }

        if (!fs.existsSync(LAST_RUN_FILE)) {
            fs.writeFileSync(LAST_RUN_FILE, JSON.stringify(defaultLastRun, null, 2));
        }
    }

    setupIncomeJob() {
        // Run every day at midnight
        scheduleJob('0 0 * * *', () => this.distributeIncome());
        this.checkMissedPayments();
    }

    async checkMissedPayments() {
        try {
            const lastRun = JSON.parse(fs.readFileSync(LAST_RUN_FILE, 'utf8'));
            const lastRunDate = new Date(lastRun.lastIncomeDate);
            const now = new Date();
            
            const diffTime = Math.abs(now - lastRunDate);
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays > 0) {
                console.log(`🕒 Found ${diffDays} missed days. Adding income...`);
                await this.distributeIncome(diffDays);
            }
        } catch (error) {
            console.error(`${getEmoji('error')} Error checking missed payments:`, error);
        }
    }

    async distributeIncome(multiplier = 1) {
        try {
            console.log(`${getEmoji('money')} Starting income distribution...`);
            
            // Wait for client to be ready with timeout
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
                    
                    // Force fetch the role and its members
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

                    // Check each fraction member for income roles
                    for (const [, member] of fractionMembers) {
                        for (const incomeRole of config.roles) {
                            if (member.roles.cache.has(incomeRole.roleId)) {
                                totalIncome += incomeRole.dailyIncome;
                                console.log(`${getEmoji('money')} ${member.user.tag} +${incomeRole.dailyIncome}`);
                            }
                        }
                    }

                    if (totalIncome > 0) {
                        const finalIncome = totalIncome * multiplier;
                        fractionData.money = (fractionData.money || 0) + finalIncome;
                        fs.writeFileSync(fractionFile, JSON.stringify(fractionData, null, 2));
                        console.log(`${getEmoji('success')} Added ${finalIncome} to ${fraction}`);
                    }
                } catch (fractionError) {
                    console.error(`${getEmoji('error')} Error processing ${fraction}:`, fractionError);
                }
            }

            // Update last run time
            fs.writeFileSync(LAST_RUN_FILE, JSON.stringify({
                lastIncomeDate: new Date().toISOString()
            }, null, 2));

            console.log(`${getEmoji('success')} Income distribution completed`);

        } catch (error) {
            console.error(`${getEmoji('error')} Fatal error:`, error);
        }
    }
}

module.exports = IncomeSystem;