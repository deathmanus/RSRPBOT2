const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { 
    addBasepoint, 
    removeBasepoint, 
    getAllBasepoints, 
    updateBasepoint,
    getActiveBasepoints 
} = require('../../Database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('manage_basepoints')
        .setDescription('Správa povolených basepointů pro capturing')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Přidá nový basepoint')
                .addStringOption(option =>
                    option
                        .setName('name')
                        .setDescription('Název basepoint')
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName('description')
                        .setDescription('Popis basepoint')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Odebere basepoint')
                .addIntegerOption(option =>
                    option
                        .setName('id')
                        .setDescription('ID basepoint k odebrání')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('Zobrazí všechny basepointy')
                .addBooleanOption(option =>
                    option
                        .setName('show_inactive')
                        .setDescription('Zobrazit i neaktivní basepointy')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('edit')
                .setDescription('Upraví existující basepoint')
                .addIntegerOption(option =>
                    option
                        .setName('id')
                        .setDescription('ID basepoint k úpravě')
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName('name')
                        .setDescription('Nový název basepoint')
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName('description')
                        .setDescription('Nový popis basepoint')
                        .setRequired(false))),

    async execute(interaction) {
        try {
            await interaction.deferReply();

            // Kontrola oprávnění
            if (!interaction.member.permissions.has('Administrator') && 
                !interaction.member.roles.cache.some(role => role.name.toLowerCase().includes('moderator'))) {
                return interaction.editReply('❌ Nemáte oprávnění k použití tohoto příkazu.');
            }

            const subcommand = interaction.options.getSubcommand();

            switch (subcommand) {
                case 'add':
                    await handleAddBasepoint(interaction);
                    break;
                case 'remove':
                    await handleRemoveBasepoint(interaction);
                    break;
                case 'list':
                    await handleListBasepoints(interaction);
                    break;
                case 'edit':
                    await handleEditBasepoint(interaction);
                    break;
            }

        } catch (error) {
            console.error('Error in manage_basepoints command:', error);
            await interaction.editReply('❌ Nastala chyba při zpracování příkazu.');
        }
    }
};

async function handleAddBasepoint(interaction) {
    const name = interaction.options.getString('name');
    const description = interaction.options.getString('description');

    try {
        const basepointId = await addBasepoint(name, description, interaction.user.id);
        
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle('✅ Basepoint přidán!')
            .setDescription(`Nový basepoint byl úspěšně přidán do seznamu povolených.`)
            .addFields(
                { name: 'Název', value: name, inline: true },
                { name: 'ID', value: basepointId.toString(), inline: true },
                { name: 'Přidal', value: interaction.user.tag, inline: true }
            )
            .setTimestamp();

        if (description) {
            embed.addFields({ name: 'Popis', value: description, inline: false });
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            await interaction.editReply('❌ Basepoint s tímto názvem už existuje!');
        } else {
            console.error('Error adding basepoint:', error);
            await interaction.editReply('❌ Nastala chyba při přidávání basepoint.');
        }
    }
}

async function handleRemoveBasepoint(interaction) {
    const basepointId = interaction.options.getInteger('id');

    try {
        const success = await removeBasepoint(basepointId);
        
        if (success) {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('🗑️ Basepoint odebrán!')
                .setDescription(`Basepoint s ID ${basepointId} byl deaktivován.`)
                .addFields(
                    { name: 'ID', value: basepointId.toString(), inline: true },
                    { name: 'Odebral', value: interaction.user.tag, inline: true }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } else {
            await interaction.editReply('❌ Basepoint s tímto ID nebyl nalezen.');
        }

    } catch (error) {
        console.error('Error removing basepoint:', error);
        await interaction.editReply('❌ Nastala chyba při odebírání basepoint.');
    }
}

async function handleListBasepoints(interaction) {
    const showInactive = interaction.options.getBoolean('show_inactive') || false;

    const callback = showInactive ? getAllBasepoints : getActiveBasepoints;
    
    callback((err, basepoints) => {
        if (err) {
            console.error('Error fetching basepoints:', err);
            return interaction.editReply('❌ Nastala chyba při načítání basepointů.');
        }

        if (!basepoints || basepoints.length === 0) {
            return interaction.editReply('📋 **Žádné basepointy**\n\nV databázi nejsou žádné basepointy.');
        }

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('📋 Seznam basepointů')
            .setTimestamp();

        if (showInactive) {
            embed.setDescription(`Celkem basepointů: ${basepoints.length} (včetně neaktivních)`);
        } else {
            embed.setDescription(`Aktivních basepointů: ${basepoints.length}`);
        }

        // Rozdělení na aktivní a neaktivní
        const activeBasepoints = basepoints.filter(bp => bp.is_active === 1);
        const inactiveBasepoints = basepoints.filter(bp => bp.is_active === 0);

        // Aktivní basepointy
        if (activeBasepoints.length > 0) {
            const activeList = activeBasepoints
                .map(bp => `• **${bp.name}** (ID: ${bp.id})${bp.description ? ` - ${bp.description}` : ''}`)
                .join('\n');
            
            embed.addFields({
                name: `🟢 Aktivní basepointy (${activeBasepoints.length})`,
                value: activeList.length > 1024 ? activeList.substring(0, 1020) + '...' : activeList,
                inline: false
            });
        }

        // Neaktivní basepointy (pokud se mají zobrazit)
        if (showInactive && inactiveBasepoints.length > 0) {
            const inactiveList = inactiveBasepoints
                .map(bp => `• ~~${bp.name}~~ (ID: ${bp.id})${bp.description ? ` - ${bp.description}` : ''}`)
                .join('\n');
            
            embed.addFields({
                name: `🔴 Neaktivní basepointy (${inactiveBasepoints.length})`,
                value: inactiveList.length > 1024 ? inactiveList.substring(0, 1020) + '...' : inactiveList,
                inline: false
            });
        }

        embed.addFields({
            name: '🔧 Správa',
            value: 'Použijte `/manage_basepoints add/remove/edit` pro správu basepointů.',
            inline: false
        });

        interaction.editReply({ embeds: [embed] });
    });
}

async function handleEditBasepoint(interaction) {
    const basepointId = interaction.options.getInteger('id');
    const newName = interaction.options.getString('name');
    const newDescription = interaction.options.getString('description');

    try {
        const success = await updateBasepoint(basepointId, newName, newDescription);
        
        if (success) {
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✏️ Basepoint upraven!')
                .setDescription(`Basepoint s ID ${basepointId} byl úspěšně upraven.`)
                .addFields(
                    { name: 'ID', value: basepointId.toString(), inline: true },
                    { name: 'Nový název', value: newName, inline: true },
                    { name: 'Upravil', value: interaction.user.tag, inline: true }
                )
                .setTimestamp();

            if (newDescription) {
                embed.addFields({ name: 'Nový popis', value: newDescription, inline: false });
            }

            await interaction.editReply({ embeds: [embed] });
        } else {
            await interaction.editReply('❌ Basepoint s tímto ID nebyl nalezen.');
        }

    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            await interaction.editReply('❌ Basepoint s tímto názvem už existuje!');
        } else {
            console.error('Error updating basepoint:', error);
            await interaction.editReply('❌ Nastala chyba při úpravě basepoint.');
        }
    }
}
