const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Load fractions on bot start
const fractionsDir = path.join(__dirname, '../../files/Fractions');
const fractions = fs.readdirSync(fractionsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('money')
        .setDescription('Spravuje peníze frakcí')
        .addSubcommand(subcommand =>
            subcommand
                .setName('give')
                .setDescription('Přidá peníze frakci')
                .addStringOption(option => {
                    let opt = option.setName('frakce')
                        .setDescription('Vyberte frakci')
                        .setRequired(true);
                    fractions.forEach(fraction => {
                        opt.addChoices({ name: fraction, value: fraction });
                    });
                    return opt;
                })
                .addIntegerOption(option =>
                    option.setName('částka')
                        .setDescription('Částka, kterou chcete přidat')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Odebere peníze frakci')
                .addStringOption(option => {
                    let opt = option.setName('frakce')
                        .setDescription('Vyberte frakci')
                        .setRequired(true);
                    fractions.forEach(fraction => {
                        opt.addChoices({ name: fraction, value: fraction });
                    });
                    return opt;
                })
                .addIntegerOption(option =>
                    option.setName('částka')
                        .setDescription('Částka, kterou chcete odebrat')
                        .setRequired(true))),

    async execute(interaction) {
        try {
            const fractionName = interaction.options.getString('frakce');
            const amount = interaction.options.getInteger('částka');
            const isAdding = interaction.options.getSubcommand() === 'give';

            if (amount <= 0) {
                return await interaction.reply({ 
                    content: '❌ Částka musí být větší než 0.', 
                    ephemeral: true 
                });
            }

            const fractionFilePath = path.join(fractionsDir, fractionName, `${fractionName}.json`);

            if (!fs.existsSync(fractionFilePath)) {
                return await interaction.reply({ 
                    content: '❌ Tato frakce neexistuje.', 
                    ephemeral: true 
                });
            }

            let fractionData = JSON.parse(fs.readFileSync(fractionFilePath, 'utf8'));

            if (!isAdding && fractionData.money < amount) {
                return await interaction.reply({ 
                    content: '❌ Frakce nemá dostatek peněz.', 
                    ephemeral: true 
                });
            }

            fractionData.money = isAdding ? 
                fractionData.money + amount : 
                fractionData.money - amount;

            fs.writeFileSync(fractionFilePath, JSON.stringify(fractionData, null, 2), 'utf8');

            const embed = new EmbedBuilder()
                .setColor(isAdding ? 0x00FF00 : 0xFF0000)
                .setTitle(`💰 Peníze ${isAdding ? 'přidány' : 'odebrány'}`)
                .setDescription(`${isAdding ? 'Frakce' : 'Frakci'} **${fractionName}** ${isAdding ? 'obdržela' : 'bylo odebráno'} **${amount} $**.`)
                .addFields({ 
                    name: 'Nový zůstatek', 
                    value: `${fractionData.money} $`, 
                    inline: true 
                });

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Chyba při správě peněz:', error);
            await interaction.reply({ 
                content: '❌ Nastala chyba při správě peněz.', 
                ephemeral: true 
            });
        }
    }
};