const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getEmoji } = require('../../utils/emojiUtils');
const fs = require('fs');
const path = require('path');
const { db, getFractionByName, updateFraction, addAuditLog } = require('../../Database/database');

// Load fractions from database
let fractions = [];
db.all(`SELECT name FROM fractions`, [], (err, rows) => {
    if (!err && rows) {
        fractions = rows.map(row => row.name);
    }
});

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
            // Refresh fractions list before execution
            await new Promise((resolve) => {
                db.all(`SELECT name FROM fractions`, [], (err, rows) => {
                    if (!err && rows) {
                        fractions = rows.map(row => row.name);
                    }
                    resolve();
                });
            });
            
            const fractionName = interaction.options.getString('frakce');
            const amount = interaction.options.getInteger('částka');
            const isAdding = interaction.options.getSubcommand() === 'give';

            if (amount <= 0) {
                return await interaction.reply({ 
                    content: `${getEmoji('error')} Částka musí být větší než 0.`, 
                    ephemeral: true 
                });
            }
            
            // Get fraction data from database
            let fractionData;
            await new Promise((resolve) => {
                getFractionByName(fractionName, (err, fraction) => {
                    fractionData = fraction;
                    resolve();
                });
            });

            if (!fractionData) {
                return await interaction.reply({ 
                    content: `${getEmoji('error')} Tato frakce neexistuje.`, 
                    ephemeral: true 
                });
            }

            if (!isAdding && fractionData.money < amount) {
                return await interaction.reply({ 
                    content: `${getEmoji('error')} Frakce nemá dostatek peněz.`, 
                    ephemeral: true 
                });
            }

            const oldMoney = fractionData.money;
            const newMoney = isAdding ? 
                oldMoney + amount : 
                oldMoney - amount;
            
            // Update fraction money in database using optimized function
            try {
                await updateFractionMoney(fractionData.id, amount, isAdding);
            } catch (error) {
                console.error('Error updating fraction money:', error);
                return await interaction.reply({ 
                    content: `${getEmoji('error')} Nastala chyba při aktualizaci peněz.`, 
                    ephemeral: true 
                });
            }
            
            // Log the money change
            addAuditLog(
                interaction.user.id,
                isAdding ? 'add_money' : 'remove_money',
                'fraction',
                fractionData.id.toString(),
                JSON.stringify({ 
                    fractionName: fractionData.name, 
                    amount: amount,
                    oldBalance: oldMoney,
                    newBalance: newMoney
                })
            );

            const embed = new EmbedBuilder()
                .setColor(isAdding ? 0x00FF00 : 0xFF0000)
                .setTitle(`${getEmoji('money')} Peníze ${isAdding ? 'přidány' : 'odebrány'}`)
                .setDescription(`${isAdding ? 'Frakce' : 'Frakci'} **${fractionName}** ${isAdding ? 'obdržela' : 'bylo odebráno'} **${amount} ${getEmoji('money')}**.`)
                .addFields({ 
                    name: 'Nový zůstatek', 
                    value: `${newMoney} ${getEmoji('money')}`, 
                    inline: true 
                });

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Chyba při správě peněz:', error);
            await interaction.reply({ 
                content: `${getEmoji('error')} Nastala chyba při správě peněz.`, 
                ephemeral: true 
            });
        }
    }
};