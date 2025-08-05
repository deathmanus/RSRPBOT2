const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, ChannelType, PermissionsBitField, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { getTicketConfig, initTicketConfig, updateFractionMoney, getFractionById, getFractionByName } = require('../../Database/database');

class TicketHandler {
    static usedResponses = new Map(); // Track used responses per channel
    static rewardsClaimed = new Map();

    static async handleTicketCreate(interaction) {
        try {
            // Ihned odložíme odpověď, abychom zabránili vypršení interakce
            await interaction.deferUpdate().catch(e => console.error('Failed to defer update:', e));
            
            // Načtení konfigurace z databáze
            const config = await new Promise((resolve, reject) => {
                getTicketConfig((err, config) => {
                    if (err) reject(err);
                    else resolve(config);
                });
            });
            
            // Pokud konfigurace neexistuje, inicializuj ji z původního souboru
            if (!config) {
                await initTicketConfig();
                try {
                    await interaction.followUp({ 
                        content: 'Ticket systém byl inicializován. Prosím zkuste to znovu.',
                        ephemeral: true
                    });
                } catch (e) {
                    console.error('Failed to send initialization message:', e);
                }
                return;
            }
            
            const category = config.categories.find(c => c.id === interaction.values[0]);
            if (!category) return;

            const channel = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username}-${interaction.user.id}`,
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

        // Handle image - check if it's a URL or local file
        if (category.message.image) {
            try {
                new URL(category.message.image);
                // It's a valid URL
                embed.setImage(category.message.image);
            } catch {
                // It's not a URL, try to load as local file
                // Nejprve zkusíme nové umístění
                let imagePath = path.join(__dirname, '../../files/TicketSystem/images', category.message.image);
                
                // Pokud soubor neexistuje, zkusíme staré umístění
                if (!fs.existsSync(imagePath)) {
                    imagePath = path.join(__dirname, '../../files old DO NOT USE/TicketSystem/images', category.message.image);
                }
                
                if (fs.existsSync(imagePath)) {
                    embed.setImage(`attachment://${category.message.image}`);
                }
                // If file doesn't exist, simply don't set any image
            }
        }

        // Handle thumbnail - check if it's a URL or local file
        if (category.message.thumbnail) {
            try {
                new URL(category.message.thumbnail);
                // It's a valid URL
                embed.setThumbnail(category.message.thumbnail);
            } catch {
                // It's not a URL, try to load as local file
                // Nejprve zkusíme nové umístění
                let thumbnailPath = path.join(__dirname, '../../files/TicketSystem/images', category.message.thumbnail);
                
                // Pokud soubor neexistuje, zkusíme staré umístění
                if (!fs.existsSync(thumbnailPath)) {
                    thumbnailPath = path.join(__dirname, '../../files old DO NOT USE/TicketSystem/images', category.message.thumbnail);
                }
                
                if (fs.existsSync(thumbnailPath)) {
                    embed.setThumbnail(`attachment://${category.message.thumbnail}`);
                }
                // If file doesn't exist, simply don't set any thumbnail
            }
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

        // Filter out blank or incomplete responseOptions
        const validOptions = (Array.isArray(category.responseOptions) ? category.responseOptions : [])
            .filter(option => option && option.id && option.label && option.description);

        let components = [buttons];
        if (validOptions.length > 0) {
            const responseMenu = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('ticket_response')
                        .setPlaceholder('Select a response')
                        .addOptions(
                            validOptions.map(option => ({
                                label: option.label,
                                description: option.description,
                                value: option.id
                            }))
                        )
                );
            components = [responseMenu, buttons];
        }

        // Prepare files array for local images
        const files = [];
        if (category.message.image && !category.message.image.startsWith('http')) {
            const imagePath = path.join(__dirname, '../../files/TicketSystem/images', category.message.image);
            if (fs.existsSync(imagePath)) {
                files.push({
                    attachment: imagePath,
                    name: category.message.image
                });
            }
        }
        if (category.message.thumbnail && !category.message.thumbnail.startsWith('http')) {
            const thumbnailPath = path.join(__dirname, '../../files/TicketSystem/images', category.message.thumbnail);
            if (fs.existsSync(thumbnailPath)) {
                files.push({
                    attachment: thumbnailPath,
                    name: category.message.thumbnail
                });
            }
        }

        const messageOptions = { 
            content: `<@${interaction.user.id}>`,
            embeds: [embed],
            components
        };

        // Add files if any local images exist
        if (files.length > 0) {
            messageOptions.files = files;
        }

        await channel.send(messageOptions);

        // Initialize rewards tracking for this channel
        this.rewardsClaimed.set(channel.id, new Set());

        // Použijeme editReply místo update, protože jsme již použili deferUpdate
        try {
            await interaction.editReply({ 
                components: [interaction.message.components[0]]
            });
        } catch (e) {
            console.error('Failed to update components after creating ticket:', e);
        }
        } catch (error) {
            console.error('Error creating ticket:', error);
            try {
                await interaction.followUp({ 
                    content: 'Nastala chyba při vytváření ticketu. Zkuste to prosím znovu.',
                    ephemeral: true
                });
            } catch (replyError) {
                console.error('Failed to send error message:', replyError);
            }
        }
    }

    static async handleTicketClose(interaction) {
        try {
            // Ihned odložíme odpověď, abychom zabránili vypršení interakce
            await interaction.deferReply({ ephemeral: true }).catch(e => console.error('Failed to defer reply:', e));
            
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

            await interaction.editReply({
                content: 'Opravdu chcete zavřít tento ticket?',
                components: [confirmRow],
                ephemeral: true
            });
        } catch (error) {
            console.error('Error closing ticket:', error);
            try {
                await interaction.editReply({
                    content: 'Nastala chyba při zavírání ticketu.',
                    ephemeral: true
                });
            } catch (e) {
                console.error('Failed to send error message for ticket close:', e);
            }
        }
    }

    static async handleTicketCloseConfirm(interaction) {
        try {
            // Ihned odložíme odpověď, abychom zabránili vypršení interakce
            await interaction.deferUpdate().catch(e => console.error('Failed to defer update for close confirm:', e));
            
            this.usedResponses.delete(interaction.channel.id);
            
            // Pošleme zprávu, že se kanál maže
            try {
                await interaction.followUp({
                    content: 'Ticket se zavírá...',
                    ephemeral: true
                });
            } catch (e) {
                console.error('Failed to send closing message:', e);
            }
            
            // Počkáme 1 sekundu a pak smažeme kanál
            setTimeout(async () => {
                try {
                    await interaction.channel.delete();
                } catch (deleteError) {
                    console.error('Error deleting channel:', deleteError);
                }
            }, 1000);
        } catch (error) {
            console.error('Error deleting ticket:', error);
            try {
                await interaction.followUp({
                    content: 'Nastala chyba při mazání ticketu.',
                    ephemeral: true
                });
            } catch (replyError) {
                console.error('Failed to send error message:', replyError);
            }
        }
    }

    static async handleTicketCloseCancel(interaction) {
        try {
            // Ihned odložíme odpověď, abychom zabránili vypršení interakce
            await interaction.deferUpdate().catch(e => console.error('Failed to defer update for close cancel:', e));
            
            await interaction.editReply({
                content: 'Zavření ticketu bylo zrušeno.',
                components: [],
                ephemeral: true
            });
        } catch (error) {
            console.error('Error canceling ticket close:', error);
            try {
                await interaction.followUp({
                    content: 'Nastala chyba při rušení zavření ticketu.',
                    ephemeral: true
                });
            } catch (replyError) {
                console.error('Failed to send error message:', replyError);
            }
        }
    }

    static async handleTicketArchive(interaction) {
        try {
            // Ihned odložíme odpověď, abychom zabránili vypršení interakce
            await interaction.deferReply().catch(e => console.error('Failed to defer reply for archive:', e));
            
            this.usedResponses.delete(interaction.channel.id);
            
            // Načtení konfigurace z databáze
            const config = await new Promise((resolve, reject) => {
                getTicketConfig((err, config) => {
                    if (err) reject(err);
                    else resolve(config);
                });
            });
            
            if (!config) {
                return await interaction.reply({
                    content: 'Nastala chyba při načítání konfigurace ticketů.',
                    ephemeral: true
                });
            }
            
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

                await interaction.editReply({ 
                    content: 'Ticket byl archivován.',
                    components: [unarchiveRow],
                    ephemeral: false 
                });
            } else {
                await interaction.editReply({
                    content: 'Nelze najít kategorii pro archivaci.',
                    ephemeral: true
                });
            }
        } catch (error) {
            console.error('Error archiving ticket:', error);
            try {
                await interaction.editReply({
                    content: 'Nastala chyba při archivaci ticketu.',
                    ephemeral: true
                });
            } catch (e) {
                console.error('Failed to send error message for archive:', e);
            }
        }
    }

    static async handleTicketUnarchive(interaction) {
        try {
            // Ihned odložíme odpověď, abychom zabránili vypršení interakce
            await interaction.deferReply().catch(e => console.error('Failed to defer reply for unarchive:', e));
            // Načtení konfigurace z databáze
            const config = await new Promise((resolve, reject) => {
                getTicketConfig((err, config) => {
                    if (err) reject(err);
                    else resolve(config);
                });
            });
            
            if (!config) {
                return await interaction.reply({
                    content: 'Nastala chyba při načítání konfigurace ticketů.',
                    ephemeral: true
                });
            }
            
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

            await interaction.editReply({
                content: 'Ticket byl odarchivován.',
                ephemeral: false
            });
        }
        } catch (error) {
            console.error('Error unarchiving ticket:', error);
            try {
                await interaction.editReply({
                    content: 'Nastala chyba při odarchivování ticketu.',
                    ephemeral: true
                });
            } catch (e) {
                console.error('Failed to send error message for unarchive:', e);
            }
        }
    }

    static async handleTicketResponse(interaction) {
        try {
            // Ihned odložíme odpověď, abychom zabránili vypršení interakce
            await interaction.deferReply().catch(e => console.error('Failed to defer reply for response:', e));
            // Načtení konfigurace z databáze
            const config = await new Promise((resolve, reject) => {
                getTicketConfig((err, config) => {
                    if (err) reject(err);
                    else resolve(config);
                });
            });
            
            if (!config) {
                return await interaction.reply({
                    content: 'Nastala chyba při načítání konfigurace ticketů.',
                    ephemeral: true
                });
            }
            
            const categoryId = interaction.channel.parent.id;
            const category = config.categories.find(c => c.categoryId === categoryId);
            
            if (!category) return;

            const selectedOption = category.responseOptions.find(option => option.id === interaction.values[0]);
            if (!selectedOption) return;

            const response = new EmbedBuilder()
                .setColor(config.embedColor)
                .setTitle(selectedOption.label);

            // Check if this option has a money reward and prepare components first
            const components = [];
            if (selectedOption.moneyReward?.enabled) {
                const channelRewardsClaimed = this.rewardsClaimed.get(interaction.channel.id) || new Set();
                
                if (!channelRewardsClaimed.has(selectedOption.id)) {
                    console.log('Creating reward button for option:', selectedOption.id);
                    const rewardButton = new ButtonBuilder()
                        .setCustomId(`reward_${selectedOption.id}`)
                        .setLabel(selectedOption.moneyReward.buttonLabel || 'Claim Reward')
                        .setStyle(ButtonStyle.Primary);
                    console.log('Created button with customId:', `reward_${selectedOption.id}`);

                    components.push(new ActionRowBuilder().addComponents(rewardButton));
                }
            }

            // Handle different response types
            if (selectedOption.type === 'image') {
                try {
                    new URL(selectedOption.content);
                    // It's a valid URL
                    response.setImage(selectedOption.content);
                    await interaction.editReply({
                        embeds: [response],
                        components: components,
                        ephemeral: false
                    });
                } catch {
                    // It's not a URL, try to load as local file
                    const imagePath = path.join(__dirname, '../../files/TicketSystem/images', selectedOption.content);
                    if (fs.existsSync(imagePath)) {
                        response.setImage(`attachment://${selectedOption.content}`);
                        await interaction.editReply({
                            embeds: [response],
                            files: [{
                                attachment: imagePath,
                                name: selectedOption.content
                            }],
                            components: components,
                            ephemeral: false
                        });
                    } else {
                        // File doesn't exist, send without image
                        response.setDescription('Obrázek nebyl nalezen.');
                        await interaction.editReply({
                            embeds: [response],
                            components: components,
                            ephemeral: false
                        });
                    }
                }
            } else if (selectedOption.type === 'randomImage') {
                const imageDir = path.join(__dirname, '../../files/TicketSystem/images');
                console.log('📂 Checking directory:', imageDir);
                
                if (!fs.existsSync(imageDir)) {
                    console.log('❌ Directory does not exist');
                    fs.mkdirSync(imageDir, { recursive: true });
                }
                
                const imageFiles = fs.readdirSync(imageDir)
                    .filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file));
                
                console.log('📸 Found images:', imageFiles);
                
                if (imageFiles.length === 0) {
                    response.setDescription('Nenalezeny žádné obrázky ve složce.');
                    await interaction.editReply({
                        embeds: [response],
                        components: components,
                        ephemeral: false
                    });
                } else {
                    const randomImage = imageFiles[Math.floor(Math.random() * imageFiles.length)];
                    const imagePath = path.join(imageDir, randomImage);
                    console.log('🎲 Selected image:', randomImage);
                    console.log('📄 Full image path:', imagePath);
                    
                    response.setDescription(`Náhodně vybraný obrázek: ${randomImage}`);
                    await interaction.editReply({ 
                        embeds: [response],
                        files: [imagePath],
                        components: components,
                        ephemeral: false 
                    });
                }
            } else {
                response.setDescription(selectedOption.content);
                await interaction.editReply({
                    embeds: [response],
                    components: components,
                    ephemeral: false
                });
            }

            // Update menu visibility and options
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
        } catch (error) {
            console.error('Error processing response:', error);
            console.error('Error details:', error.message);
            console.error('Error stack:', error.stack);
            try {
                await interaction.editReply({
                    content: '❌ Chyba při zpracování odpovědi. Kontaktujte prosím administrátora.',
                    ephemeral: true
                });
            } catch (e) {
                console.error('Failed to send error message for response processing:', e);
            }
        }
    }

    static async handleRewardClaim(interaction) {
        try {
            // Ihned odložíme odpověď, abychom zabránili vypršení interakce
            await interaction.deferUpdate().catch(e => console.error('Failed to defer update for reward claim:', e));
            
            console.log('🎯 Starting reward claim process...');
            console.log('Full customId:', interaction.customId); // Debug log
            
            // Načtení konfigurace z databáze
            const config = await new Promise((resolve, reject) => {
                getTicketConfig((err, config) => {
                    if (err) reject(err);
                    else resolve(config);
                });
            });
            
            if (!config) {
                return await interaction.reply({
                    content: 'Nastala chyba při načítání konfigurace ticketů.',
                    ephemeral: true
                });
            }
            
            console.log('📁 Loaded config from database');
            
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
            const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
            console.log('Has admin:', isAdmin);

            const hasAllowedRole = selectedOption.moneyReward.allowedRoles.some(roleId => 
                interaction.member.roles.cache.has(roleId)
            );
            const hasPermission = isAdmin || hasAllowedRole;

            console.log('✅ Has permission:', hasPermission);

            if (!hasPermission) {
                console.log('❌ Permission denied');
                try {
                    await interaction.followUp({
                        content: '❌ Nemáte oprávnění udělit tuto odměnu. Musíte být buď administrátor, nebo mít jednu z povolených rolí.',
                        ephemeral: true
                    });
                } catch (e) {
                    console.error('Failed to send permission error message:', e);
                }
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
                try {
                    await interaction.followUp({
                        content: '❌ Could not find the ticket creator.',
                        ephemeral: true
                    });
                } catch (e) {
                    console.error('Failed to send target member error message:', e);
                }
                return;
            }

            // Check if reward was already claimed
            const channelRewardsClaimed = this.rewardsClaimed.get(interaction.channel.id) || new Set();
            console.log('🎫 Previously claimed rewards:', Array.from(channelRewardsClaimed));
            
            if (channelRewardsClaimed.has(rewardId)) {
                console.log('❌ Reward already claimed');
                try {
                    await interaction.followUp({
                        content: '❌ This reward has already been claimed.',
                        ephemeral: true
                    });
                } catch (e) {
                    console.error('Failed to send already claimed error message:', e);
                }
                return;
            }

            // Find user's fraction
            console.log('🔍 Searching for user fraction...');
            let userFraction = null;
            
            // Projdeme role uživatele a hledáme frakci
            for (const role of targetMember.roles.cache.values()) {
                try {
                    const fraction = await new Promise((resolve) => {
                        getFractionByName(role.name, (err, fraction) => {
                            if (err) {
                                console.error(`Error checking fraction for role ${role.name}:`, err);
                                resolve(null);
                            } else {
                                resolve(fraction);
                            }
                        });
                    });
                    
                    if (fraction) {
                        userFraction = fraction;
                        console.log('✅ Found user fraction:', fraction.name);
                        break;
                    }
                } catch (error) {
                    console.error(`Error checking fraction for role ${role.name}:`, error);
                }
            }

            if (!userFraction) {
                console.log('❌ User fraction not found');
                try {
                    await interaction.followUp({
                        content: '❌ Ticket creator is not in any fraction.',
                        ephemeral: true
                    });
                } catch (e) {
                    console.error('Failed to send fraction not found error message:', e);
                }
                return;
            }

            // Add money to fraction
            console.log('💰 Adding money to fraction...');
            const oldBalance = userFraction.money || 0;
            
            try {
                await updateFractionMoney(userFraction.id, selectedOption.moneyReward.amount, true);
                console.log(`Balance update: ${oldBalance} -> ${oldBalance + selectedOption.moneyReward.amount}`);
                
                // Aktualizujeme hodnotu peněz pro zobrazení
                userFraction.money = oldBalance + selectedOption.moneyReward.amount;
                
                console.log('✅ Money added successfully');
            } catch (error) {
                console.error('Error updating fraction money:', error);
                try {
                    await interaction.followUp({
                        content: '❌ Nastala chyba při přidávání peněz frakci.',
                        ephemeral: true
                    });
                } catch (e) {
                    console.error('Failed to send money update error message:', e);
                }
                return;
            }

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
                    .setDescription(`${targetMember} has received ${selectedOption.moneyReward.amount}$ for their fraction ${userFraction.name}!`)
                    .addFields({
                        name: 'New Balance',
                        value: `${userFraction.money}$`,
                        inline: true
                    });

                await interaction.channel.send({ embeds: [embed] });
                console.log('✅ Confirmation message sent');
            } catch (buttonError) {
                console.error('❌ Error updating button:', buttonError);
                // If button update fails, still try to send confirmation
                await interaction.channel.send({ 
                    content: `💰 ${targetMember} has received ${selectedOption.moneyReward.amount}$ for their fraction ${userFraction.name}!\nNew balance: ${userFraction.money}$`
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