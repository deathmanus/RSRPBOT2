const { getSSUStatus, getActiveFractionCaptures, updateFractionMoney, getFractionByName } = require('../Database/database');
const { getEmojiSync } = require('../utils/emojiUtils');

class CaptureRewardSystem {
    constructor(client) {
        this.client = client;
        this.rewardInterval = null;
        this.REWARD_AMOUNT = 2; // 2 body za basepoint
        this.REWARD_INTERVAL = 30 * 60 * 1000; // 30 minut v milisekundách
    }

    start() {
        console.log(`${getEmojiSync('info')} Starting capture reward system...`);
        this.checkAndStartRewards();
        
        // Kontrola každých 5 minut, zda má běžet systém odměn
        setInterval(() => {
            this.checkAndStartRewards();
        }, 5 * 60 * 1000); // 5 minut
    }

    checkAndStartRewards() {
        getSSUStatus((err, ssuStatus) => {
            if (err) {
                console.error('Error checking SSU status:', err);
                return;
            }

            if (ssuStatus && ssuStatus.is_active) {
                if (!this.rewardInterval) {
                    console.log(`${getEmojiSync('success')} SSU is active, starting reward distribution...`);
                    this.startRewardDistribution();
                }
            } else {
                if (this.rewardInterval) {
                    console.log(`${getEmojiSync('info')} SSU is not active, stopping reward distribution...`);
                    this.stopRewardDistribution();
                }
            }
        });
    }

    startRewardDistribution() {
        if (this.rewardInterval) {
            clearInterval(this.rewardInterval);
        }

        this.rewardInterval = setInterval(() => {
            this.distributeRewards();
        }, this.REWARD_INTERVAL);

        // Okamžitě spustit první rozdělení odměn
        setTimeout(() => {
            this.distributeRewards();
        }, 5000); // 5 sekund zpoždění pro inicializaci
    }

    stopRewardDistribution() {
        if (this.rewardInterval) {
            clearInterval(this.rewardInterval);
            this.rewardInterval = null;
        }
    }

    async distributeRewards() {
        try {
            console.log(`${getEmojiSync('info')} Distributing capture rewards...`);

            getActiveFractionCaptures((err, captures) => {
                if (err) {
                    console.error('Error fetching active captures:', err);
                    return;
                }

                if (!captures || captures.length === 0) {
                    console.log(`${getEmojiSync('info')} No active captures found, skipping reward distribution.`);
                    return;
                }

                let rewardsDistributed = 0;
                let totalRewards = 0;

                captures.forEach(capture => {
                    const rewardAmount = capture.capture_count * this.REWARD_AMOUNT;
                    
                    getFractionByName(capture.fraction_name, (err, fraction) => {
                        if (err || !fraction) {
                            console.error(`Error finding fraction ${capture.fraction_name}:`, err);
                            return;
                        }

                        updateFractionMoney(fraction.id, rewardAmount, true)
                            .then(() => {
                                rewardsDistributed++;
                                totalRewards += rewardAmount;
                                
                                console.log(`${getEmojiSync('success')} Rewarded ${rewardAmount} points to ${capture.fraction_name} for ${capture.capture_count} captures`);

                                // Pokud jsou všechny odměny rozděleny, pošleme zprávu do kanálu
                                if (rewardsDistributed === captures.length) {
                                    this.sendRewardNotification(captures, totalRewards);
                                }
                            })
                            .catch(error => {
                                console.error(`Error updating money for ${capture.fraction_name}:`, error);
                            });
                    });
                });
            });

        } catch (error) {
            console.error('Error in reward distribution:', error);
        }
    }

    async sendRewardNotification(captures, totalRewards) {
        try {
            // Najít kanál pro oznámení (můžete upravit podle vašich potřeb)
            const guild = this.client.guilds.cache.first();
            if (!guild) return;

            // Hledání kanálu s názvem obsahujícím "log", "counting" nebo podobně
            const notificationChannel = guild.channels.cache.find(channel => 
                channel.name.toLowerCase().includes('log') || 
                channel.name.toLowerCase().includes('counting') ||
                channel.name.toLowerCase().includes('bot') ||
                channel.name.toLowerCase().includes('capture')
            );

            if (notificationChannel && notificationChannel.isTextBased()) {
                const { EmbedBuilder } = require('discord.js');
                
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('💰 Odměny za capturing rozděleny!')
                    .setDescription('Frakce dostaly body za zabrané basepointy:')
                    .setTimestamp()
                    .setFooter({ text: 'Capturing Reward System' });

                captures.forEach(capture => {
                    const rewardAmount = capture.capture_count * this.REWARD_AMOUNT;
                    embed.addFields({
                        name: capture.fraction_name,
                        value: `${capture.capture_count} basepointů = **${rewardAmount} bodů**`,
                        inline: true
                    });
                });

                embed.addFields({
                    name: 'Celkem rozděleno',
                    value: `**${totalRewards} bodů**`,
                    inline: false
                });

                embed.addFields({
                    name: 'ℹ️ Příští rozdělení',
                    value: 'Za 30 minut',
                    inline: false
                });

                await notificationChannel.send({ embeds: [embed] });
                console.log(`${getEmojiSync('success')} Reward notification sent to #${notificationChannel.name}`);
            } else {
                console.log(`${getEmojiSync('warning')} No suitable notification channel found for reward notifications`);
            }

        } catch (error) {
            console.error('Error sending reward notification:', error);
        }
    }

    stop() {
        console.log(`${getEmojiSync('info')} Stopping capture reward system...`);
        this.stopRewardDistribution();
    }
}

module.exports = CaptureRewardSystem;
