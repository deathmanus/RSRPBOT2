const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Načtení frakcí při spuštění bota
const fractionsDir = path.join(__dirname, '../../files/Fractions');
const fractions = fs.readdirSync(fractionsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('givemoney')
        .setDescription('Přidá peníze frakci.')
        .addStringOption(option => {
            let opt = option.setName('frakce')
                .setDescription('Vyberte frakci, které chcete přidat peníze')
                .setRequired(true);
            
            // Pokud existují frakce, přidáme je jako volby
            fractions.forEach(fraction => {
                opt.addChoices({ name: fraction, value: fraction });
            });

            return opt;
        })
        .addIntegerOption(option =>
            option.setName('částka')
                .setDescription('Částka, kterou chcete přidat')
                .setRequired(true)),

    async execute(interaction) {
        try {
            const fractionName = interaction.options.getString('frakce');
            const amount = interaction.options.getInteger('částka');

            if (amount <= 0) {
                return await interaction.reply({ content: '❌ Částka musí být větší než 0.', ephemeral: true });
            }

            const fractionFilePath = path.join(fractionsDir, fractionName, `${fractionName}.json`);

            if (!fs.existsSync(fractionFilePath)) {
                return await interaction.reply({ content: '❌ Tato frakce neexistuje.', ephemeral: true });
            }

            let fractionData = JSON.parse(fs.readFileSync(fractionFilePath, 'utf8'));

            fractionData.money += amount;

            fs.writeFileSync(fractionFilePath, JSON.stringify(fractionData, null, 2), 'utf8'); // Uložíme změny

            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('💰 Peníze přidány')
                .setDescription(`Frakce **${fractionName}** obdržela **${amount} $**.`)
                .addFields({ name: 'Nový zůstatek', value: `${fractionData.money} $`, inline: true });

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Chyba při přidávání peněz:', error);
            await interaction.reply({ content: '❌ Chyba při přidávání peněz.', ephemeral: true });
        }
    }
};