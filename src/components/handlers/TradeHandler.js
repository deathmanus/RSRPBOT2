const { EmbedBuilder } = require('discord.js');
const { getEmoji } = require('../../utils/emojiUtils');
const fs = require('fs');
const path = require('path');

async function handleTradeResponse(interaction) {
    const [action, tradeId] = interaction.customId.split(':');
    
    if (!['accept-trade', 'decline-trade'].includes(action)) return;

    try {
        await interaction.deferUpdate();

        const tradesPath = path.join(__dirname, '../../files/Trades');
        const tradePath = path.join(tradesPath, `${tradeId}.json`);

        if (!fs.existsSync(tradePath)) {
            return await interaction.editReply({
                content: `${getEmoji('error')} Tato obchodní nabídka již není platná.`,
                components: []
            });
        }

        const tradeData = JSON.parse(fs.readFileSync(tradePath, 'utf8'));
        
        if (!await checkFractionMembership(interaction, tradeData)) return;

        if (action === 'accept-trade') {
            await processTrade(interaction, tradeData, tradePath);
        } else {
            await declineTrade(interaction, tradeData, tradePath);
        }
    } catch (error) {
        console.error('Error handling trade response:', error);
        await interaction.followUp({
            content: `${getEmoji('error')} Nastala chyba při zpracování odpovědi na obchodní nabídku.`,
            ephemeral: true
        });
    }
}

async function checkFractionMembership(interaction, tradeData) {
    const member = interaction.member;
    const hasFractionRole = member.roles.cache.some(role => role.name === tradeData.buyer);

    if (!hasFractionRole) {
        await interaction.followUp({
            content: `${getEmoji('error')} Nejste členem této frakce.`,
            ephemeral: true
        });
        return false;
    }
    return true;
}

async function processTrade(interaction, tradeData, tradePath) {
    const buyerFractionPath = path.join(__dirname, '../../files/Fractions', tradeData.buyer, `${tradeData.buyer}.json`);
    const sellerFractionPath = path.join(__dirname, '../../files/Fractions', tradeData.seller, `${tradeData.seller}.json`);
    
    const buyerFractionData = JSON.parse(fs.readFileSync(buyerFractionPath, 'utf8'));
    const sellerFractionData = JSON.parse(fs.readFileSync(sellerFractionPath, 'utf8'));

    if (buyerFractionData.money < tradeData.price) {
        return await interaction.followUp({
            content: `${getEmoji('error')} Vaše frakce nemá dostatek peněz (${tradeData.price} ${getEmoji('money')}).`,
            ephemeral: true
        });
    }

    await transferTradeItems(tradeData);
    
    buyerFractionData.money -= tradeData.price;
    sellerFractionData.money += tradeData.price;
    
    fs.writeFileSync(buyerFractionPath, JSON.stringify(buyerFractionData, null, 2));
    fs.writeFileSync(sellerFractionPath, JSON.stringify(sellerFractionData, null, 2));

    tradeData.status = 'accepted';
    tradeData.acceptedBy = interaction.user.tag;
    tradeData.acceptedAt = new Date().toISOString();
    fs.writeFileSync(tradePath, JSON.stringify(tradeData, null, 2));

    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0x00FF00)
        .setTitle(`${getEmoji('success')} Obchodní nabídka přijata`)
        .addFields(
            { name: 'Přijal', value: interaction.user.tag, inline: true },
            { name: 'Stav peněz', value: `Prodávající: ${sellerFractionData.money} ${getEmoji('money')}\nKupující: ${buyerFractionData.money} ${getEmoji('money')}` }
        );

    await interaction.message.edit({
        embeds: [updatedEmbed],
        components: []
    });

    await interaction.followUp({
        content: `${getEmoji('success')} Obchodní nabídka byla úspěšně přijata a zpracována.`,
        ephemeral: true
    });
}

async function declineTrade(interaction, tradeData, tradePath) {
    tradeData.status = 'declined';
    tradeData.declinedBy = interaction.user.tag;
    tradeData.declinedAt = new Date().toISOString();
    fs.writeFileSync(tradePath, JSON.stringify(tradeData, null, 2));

    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0xFF0000)
        .setTitle(`${getEmoji('error')} Obchodní nabídka odmítnuta`)
        .addFields(
            { name: 'Odmítl', value: interaction.user.tag, inline: true }
        );

    await interaction.message.edit({
        embeds: [updatedEmbed],
        components: []
    });

    await interaction.followUp({
        content: `${getEmoji('error')} Obchodní nabídka byla odmítnuta.`,
        ephemeral: true
    });
}

async function transferTradeItems(tradeData) {
    const { buyer, seller, item, count } = tradeData;
    const fractionPath = path.join(__dirname, '../../files/Fractions');
    
    const sellerItemPath = path.join(fractionPath, seller, item.section, item.file);
    const sellerSectionPath = path.join(fractionPath, seller, item.section);
    const buyerSectionPath = path.join(fractionPath, buyer, item.section);
    
    if (!fs.existsSync(buyerSectionPath)) {
        fs.mkdirSync(buyerSectionPath, { recursive: true });
    }

    const sellerItem = JSON.parse(fs.readFileSync(sellerItemPath, 'utf8'));

    if (item.type === 'countable') {
        if (sellerItem.count === count) {
            fs.unlinkSync(sellerItemPath);
            
            const remainingFiles = fs.readdirSync(sellerSectionPath)
                .filter(file => file.endsWith('.json'));
            if (remainingFiles.length === 0) {
                fs.rmdirSync(sellerSectionPath);
                console.log('Removed empty section directory:', sellerSectionPath);
            }
        } else {
            sellerItem.count -= count;
            fs.writeFileSync(sellerItemPath, JSON.stringify(sellerItem, null, 2));
        }

        const buyerFiles = fs.readdirSync(buyerSectionPath)
            .filter(f => f.endsWith('.json'));
        
        let existingItem = null;
        let existingItemPath = null;

        for (const file of buyerFiles) {
            const currentItem = JSON.parse(fs.readFileSync(path.join(buyerSectionPath, file)));
            if (currentItem.name === item.name) {
                existingItem = currentItem;
                existingItemPath = path.join(buyerSectionPath, file);
                break;
            }
        }

        if (existingItem) {
            existingItem.count += count;
            fs.writeFileSync(existingItemPath, JSON.stringify(existingItem, null, 2));
        } else {
            const newItem = {
                ...sellerItem,
                count: count,
                id: Date.now().toString(36) + Math.random().toString(36).substr(2)
            };
            fs.writeFileSync(
                path.join(buyerSectionPath, `${newItem.id}.json`),
                JSON.stringify(newItem, null, 2)
            );
        }
    } else {
        fs.renameSync(sellerItemPath, path.join(buyerSectionPath, item.file));
        
        const remainingFiles = fs.readdirSync(sellerSectionPath)
            .filter(file => file.endsWith('.json'));
        if (remainingFiles.length === 0) {
            fs.rmdirSync(sellerSectionPath);
            console.log('Removed empty section directory:', sellerSectionPath);
        }
    }
}

module.exports = { handleTradeResponse };