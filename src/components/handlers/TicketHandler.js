const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType, PermissionsBitField, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

class TicketHandler {
    static usedResponses = new Map(); // Track used responses per channel
    static rewardsClaimed = new Map();

    static async handleTicketCreate(interaction) {
        const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../files/TicketSystem/ticket-config.json'), 'utf-8'));
        const category = config.categories.find(c => c.id === interaction.values[0]);
        
        if (!category) return;

        const channel = await interaction.guild.channels.create({
            name: `ticket-${interaction.user.username}-${interaction.user.id}`, // Přidáno ID uživatele do názvu
            type: ChannelType.GuildText,
            parent: category.categoryId,
            permissionOverwrites: [
                {
                    id: interaction.guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: interaction.user.id,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                },
            ],
        });

        // Initialize used responses tracking for this channel
        this.usedResponses.set(channel.id, new Set());

        const embed = new EmbedBuilder()
            .setTitle(category.message.title)
            .setDescription(category.message.description)
            .setColor(category.message.color);

        if (category.message.image) {
            embed.setImage(category.message.image);
        }
        if (category.message.thumbnail) {
            embed.setThumbnail(category.message.thumbnail);
        }

        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_close')
                    .setLabel(config.buttons.close.label)
                    .setStyle(ButtonStyle[config.buttons.close.style])
                    .setEmoji(config.buttons.close.emoji),
                new ButtonBuilder()
                    .setCustomId('ticket_archive')
                    .setLabel(config.buttons.archive.label)
                    .setStyle(ButtonStyle[config.buttons.archive.style])
                    .setEmoji(config.buttons.archive.emoji)
            );

        const responseMenu = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('ticket_response')
                    .setPlaceholder('Select a response')
                    .addOptions(
                        category.responseOptions.map(option => ({
                            label: option.label,
                            description: option.description,
                            value: option.id
                        }))
                    )
            );

        await channel.send({ 
            content: `<@${interaction.user.id}>`,
            embeds: [embed],
            components: [responseMenu, buttons]
        });

        // Initialize rewards tracking for this channel
        this.rewardsClaimed.set(channel.id, new Set());

        await interaction.update({ 
            components: [interaction.message.components[0]]
        });
    }

    static async handleTicketClose(interaction) {
        const confirmRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_close_confirm')
                    .setLabel('Potvrdit zavření')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('ticket_close_cancel')
                    .setLabel('Zrušit')
                    .setStyle(ButtonStyle.Secondary)
            );

        await interaction.reply({
            content: 'Opravdu chcete zavřít tento ticket?',
            components: [confirmRow],
            ephemeral: true
        });
    }

    static async handleTicketCloseConfirm(interaction) {
        this.usedResponses.delete(interaction.channel.id);
        await interaction.channel.delete();
    }

    static async handleTicketCloseCancel(interaction) {
        await interaction.update({
            content: 'Zavření ticketu bylo zrušeno.',
            components: [],
            ephemeral: true
        });
    }

    static async handleTicketArchive(interaction) {
        this.usedResponses.delete(interaction.channel.id);
        
        const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../files/TicketSystem/ticket-config.json'), 'utf-8'));
        const category = config.categories.find(c => 
            c.categoryId === interaction.channel.parent.id
        );

        if (category) {
            await interaction.channel.setParent(category.archiveCategoryId);
            await interaction.channel.permissionOverwrites.set([
                {
                    id: interaction.guild.id,
                    deny: [PermissionsBitField.Flags.SendMessages],
                    allow: [PermissionsBitField.Flags.ViewChannel],
                }
            ]);

            const unarchiveRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('ticket_unarchive')
                        .setLabel('Odarchivovat Ticket')
                        .setStyle(ButtonStyle.Primary)
                );

            await interaction.reply({ 
                content: 'Ticket byl archivován.',
                components: [unarchiveRow],
                ephemeral: false 
            });
        }
    }

    static async handleTicketUnarchive(interaction) {
        const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../files/TicketSystem/ticket-config.json'), 'utf-8'));
        const archivedCategory = config.categories.find(c => 
            c.archiveCategoryId === interaction.channel.parent.id
        );

        if (archivedCategory) {
            // Získání ID uživatele z názvu kanálu
            const channelName = interaction.channel.name;
            const userId = channelName.split('-').pop(); // Získá poslední část názvu, což je ID

            await interaction.channel.setParent(archivedCategory.categoryId);
            await interaction.channel.permissionOverwrites.set([
                {
                    id: interaction.guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: interaction.guild.members.me.id,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                },
                {
                    id: userId,
                    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                }
            ]);

            // Remove the unarchive button from the previous message
            const messages = await interaction.channel.messages.fetch({ limit: 10 });
            const archiveMessage = messages.find(m => 
                m.components.length > 0 && 
                m.components[0].components[0].customId === 'ticket_unarchive'
            );
            if (archiveMessage) {
                await archiveMessage.edit({ components: [] });
            }

            await interaction.reply({
                content: 'Ticket byl odarchivován.',
                ephemeral: false
            });
        }
    }

    static async handleTicketResponse(interaction) {
        const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../files/TicketSystem/ticket-config.json'), 'utf-8'));
        const categoryId = interaction.channel.parent.id;
        const category = config.categories.find(c => c.categoryId === categoryId);
        
        if (!category) return;

        const selectedOption = category.responseOptions.find(option => option.id === interaction.values[0]);
        if (!selectedOption) return;

        const response = new EmbedBuilder()
            .setColor(config.embedColor)
            .setTitle(selectedOption.label);

        try {
            if (selectedOption.type === 'image') {
                new URL(selectedOption.content);
                response.setImage(selectedOption.content);
            } else {
                response.setDescription(selectedOption.content);
            }

            // Check if this option has a money reward
            const components = [];
            if (selectedOption.moneyReward?.enabled) {
                const channelRewardsClaimed = this.rewardsClaimed.get(interaction.channel.id) || new Set();
                
                if (!channelRewardsClaimed.has(selectedOption.id)) {
                    console.log('Creating reward button for option:', selectedOption.id); // Debug log
                    const rewardButton = new ButtonBuilder()
                        .setCustomId(`reward_${selectedOption.id}`) // Ensure this matches exactly
                        .setLabel(selectedOption.moneyReward.buttonLabel || 'Claim Reward')
                        .setStyle(ButtonStyle.Primary);
                    console.log('Created button with customId:', `reward_${selectedOption.id}`); // Debug log

                    components.push(new ActionRowBuilder().addComponents(rewardButton));
                }
            }

            // Find the original menu message
            const messages = await interaction.channel.messages.fetch({ limit: 10 });
            const menuMessage = messages.find(m => 
                m.components.length > 0 && 
                m.components[0].components[0].customId === 'ticket_response'
            );

            if (category.hideMenuAfterSelection) {
                // Hide the entire menu
                if (menuMessage) {
                    const buttons = menuMessage.components.find(row => 
                        row.components.some(comp => ['ticket_close', 'ticket_archive'].includes(comp.customId))
                    );
                    await menuMessage.edit({ components: buttons ? [buttons] : [] });
                }
            } else {
                // Original functionality - track used responses if not keepSelectable
                if (!selectedOption.keepSelectable) {
                    let usedChannelResponses = this.usedResponses.get(interaction.channel.id) || new Set();
                    usedChannelResponses.add(selectedOption.id);
                    this.usedResponses.set(interaction.channel.id, usedChannelResponses);
                }

                // Update the select menu with available options
                if (menuMessage) {
                    const usedResponses = this.usedResponses.get(interaction.channel.id) || new Set();
                    const availableOptions = category.responseOptions.filter(option => 
                        option.keepSelectable || !usedResponses.has(option.id)
                    );

                    const updatedMenu = new ActionRowBuilder()
                        .addComponents(
                            new StringSelectMenuBuilder()
                                .setCustomId('ticket_response')
                                .setPlaceholder('Select a response')
                                .addOptions(
                                    availableOptions.map(option => ({
                                        label: option.label,
                                        description: option.description,
                                        value: option.id
                                    }))
                                )
                        );

                    const originalComponents = [...menuMessage.components];
                    originalComponents[0] = updatedMenu;
                    await menuMessage.edit({ components: originalComponents });
                }
            }

            await interaction.reply({
                embeds: [response],
                components: components,
                ephemeral: false
            });
        } catch (error) {
            console.error('Error processing response:', error);
            await interaction.reply({
                content: '❌ Chyba při zpracování odpovědi. Kontaktujte prosím administrátora.',
                ephemeral: true
            });
        }
    }

    static async handleRewardClaim(interaction) {
        try {
            console.log('🎯 Starting reward claim process...');
            console.log('Full customId:', interaction.customId); // Debug log
            
            const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../files/TicketSystem/ticket-config.json'), 'utf-8'));
            console.log('📁 Loaded config file');
            
            const categoryId = interaction.channel.parent.id;
            console.log('📂 Category ID:', categoryId);
            
            const category = config.categories.find(c => c.categoryId === categoryId);
            console.log('🔍 Found category:', category ? 'yes' : 'no');
            
            if (!category) {
                console.log('❌ Category not found');
                return;
            }

            // Fix: Get the complete reward ID without splitting at underscore
            const rewardId = interaction.customId.replace('reward_', '');
            console.log('🏷️ Reward ID:', rewardId);
            
            const selectedOption = category.responseOptions.find(option => option.id === rewardId);
            console.log('🎁 Found option:', selectedOption ? 'yes' : 'no', selectedOption);

            if (!selectedOption?.moneyReward?.enabled) {
                console.log('❌ Money reward not enabled');
                return;
            }

            // Check permissions
            console.log('🔒 Checking permissions...');
            console.log('Member roles:', interaction.member.roles.cache.map(r => r.id));
            console.log('Required roles:', selectedOption.moneyReward.allowedRoles);
            console.log('Requires admin:', selectedOption.moneyReward.requireAdmin);
            console.log('Has admin:', interaction.member.permissions.has(PermissionsBitField.Flags.Administrator));

            const hasPermission = selectedOption.moneyReward.requireAdmin ? 
                interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) :
                selectedOption.moneyReward.allowedRoles.some(roleId => interaction.member.roles.cache.has(roleId));

            console.log('✅ Has permission:', hasPermission);

            if (!hasPermission) {
                console.log('❌ Permission denied');
                await interaction.reply({
                    content: '❌ You do not have permission to give this reward.',
                    ephemeral: true
                });
                return;
            }

            // Get the ticket creator's ID
            const channelName = interaction.channel.name;
            const userId = channelName.split('-').pop();
            console.log('👤 Target user ID:', userId);

            const targetMember = await interaction.guild.members.fetch(userId);
            console.log('🎯 Found target member:', targetMember ? 'yes' : 'no');

            if (!targetMember) {
                console.log('❌ Target member not found');
                await interaction.reply({
                    content: '❌ Could not find the ticket creator.',
                    ephemeral: true
                });
                return;
            }

            // Check if reward was already claimed
            const channelRewardsClaimed = this.rewardsClaimed.get(interaction.channel.id) || new Set();
            console.log('🎫 Previously claimed rewards:', Array.from(channelRewardsClaimed));
            
            if (channelRewardsClaimed.has(rewardId)) {
                console.log('❌ Reward already claimed');
                await interaction.reply({
                    content: '❌ This reward has already been claimed.',
                    ephemeral: true
                });
                return;
            }

            // Find user's fraction
            console.log('🔍 Searching for user fraction...');
            const fractionsDir = path.join(__dirname, '../../files/Fractions');
            const fractions = fs.readdirSync(fractionsDir);
            let userFraction = null;
            let fractionFile = null;

            for (const fraction of fractions) {
                console.log('Checking fraction:', fraction);
                const rolePath = path.join(fractionsDir, fraction, `${fraction}.json`);
                if (fs.existsSync(rolePath)) {
                    const roleData = JSON.parse(fs.readFileSync(rolePath));
                    console.log('Fraction role ID:', roleData.fractionRoleId); // Changed from roleId to fractionRoleId
                    const role = await interaction.guild.roles.fetch(roleData.fractionRoleId); // Changed from roleId to fractionRoleId
                    if (role && targetMember.roles.cache.has(role.id)) {
                        userFraction = fraction;
                        fractionFile = rolePath;
                        console.log('✅ Found user fraction:', fraction);
                        break;
                    }
                }
            }

            if (!userFraction || !fractionFile) {
                console.log('❌ User fraction not found');
                await interaction.reply({
                    content: '❌ Ticket creator is not in any fraction.',
                    ephemeral: true
                });
                return;
            }

            // Add money to fraction
            console.log('💰 Adding money to fraction...');
            const fractionData = JSON.parse(fs.readFileSync(fractionFile));
            const oldBalance = fractionData.money || 0;
            fractionData.money = oldBalance + selectedOption.moneyReward.amount;
            console.log(`Balance update: ${oldBalance} -> ${fractionData.money}`);
            
            fs.writeFileSync(fractionFile, JSON.stringify(fractionData, null, 2));
            console.log('✅ Money added successfully');

            // Mark reward as claimed
            channelRewardsClaimed.add(rewardId);
            this.rewardsClaimed.set(interaction.channel.id, channelRewardsClaimed);
            console.log('✅ Reward marked as claimed');

            // Remove the claim button and send confirmation
            try {
                await interaction.deferUpdate();
                console.log('🔄 Interaction deferred');

                await interaction.message.edit({
                    components: []
                });
                console.log('✅ Button removed');

                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('💰 Reward Claimed')
                    .setDescription(`${targetMember} has received ${selectedOption.moneyReward.amount}$ for their fraction ${userFraction}!`)
                    .addFields({
                        name: 'New Balance',
                        value: `${fractionData.money}$`,
                        inline: true
                    });

                await interaction.channel.send({ embeds: [embed] });
                console.log('✅ Confirmation message sent');
            } catch (buttonError) {
                console.error('❌ Error updating button:', buttonError);
                // If button update fails, still try to send confirmation
                await interaction.channel.send({ 
                    content: `💰 ${targetMember} has received ${selectedOption.moneyReward.amount}$ for their fraction ${userFraction}!\nNew balance: ${fractionData.money}$`
                });
            }

        } catch (error) {
            console.error('❌ Error processing reward:', error);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '❌ An error occurred while processing the reward.',
                        ephemeral: true
                    });
                } else if (interaction.deferred) {
                    await interaction.editReply({
                        content: '❌ An error occurred while processing the reward.',
                        ephemeral: true
                    });
                }
            } catch (replyError) {
                console.error('Failed to send error message:', replyError);
            }
        }
    }
}

module.exports = TicketHandler;