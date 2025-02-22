const { EmbedBuilder } = require('discord.js');
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
                content: '❌ Tato obchodní nabídka již není platná.',
                components: []
            });
        }

        const tradeData = JSON.parse(fs.readFileSync(tradePath, 'utf8'));
        
        // Check buyer permissions
        if (!await checkTradePermissions(interaction, tradeData)) return;

        if (action === 'accept-trade') {
            await processTrade(interaction, tradeData, tradePath);
        } else {
            await declineTrade(interaction, tradeData, tradePath);
        }
    } catch (error) {
        console.error('Error handling trade response:', error);
        await interaction.followUp({
            content: '❌ Nastala chyba při zpracování odpovědi na obchodní nabídku.',
            ephemeral: true
        });
    }
}

async function checkTradePermissions(interaction, tradeData) {
    const member = interaction.member;
    const isLeader = member.roles.cache.some(r => r.name.includes('Velitel'));
    const isDeputy = member.roles.cache.some(r => r.name.includes('Zástupce'));
    const hasFractionRole = member.roles.cache.some(role => role.name === tradeData.buyer);

    if (!(isLeader || isDeputy) || !hasFractionRole) {
        await interaction.followUp({
            content: '❌ Nemáte oprávnění reagovat na tuto obchodní nabídku.',
            ephemeral: true
        });
        return false;
    }
    return true;
}

async function processTrade(interaction, tradeData, tradePath) {
    // Check buyer's money
    const buyerFractionPath = path.join(__dirname, '../../files/Fractions', tradeData.buyer, `${tradeData.buyer}.json`);
    const sellerFractionPath = path.join(__dirname, '../../files/Fractions', tradeData.seller, `${tradeData.seller}.json`);
    
    const buyerFractionData = JSON.parse(fs.readFileSync(buyerFractionPath, 'utf8'));
    const sellerFractionData = JSON.parse(fs.readFileSync(sellerFractionPath, 'utf8'));

    if (buyerFractionData.money < tradeData.price) {
        return await interaction.followUp({
            content: `❌ Vaše frakce nemá dostatek peněz (${tradeData.price}$).`,
            ephemeral: true
        });
    }

    // Transfer items and money
    await transferTradeItems(tradeData);
    
    // Update fraction money
    buyerFractionData.money -= tradeData.price;
    sellerFractionData.money += tradeData.price;
    
    fs.writeFileSync(buyerFractionPath, JSON.stringify(buyerFractionData, null, 2));
    fs.writeFileSync(sellerFractionPath, JSON.stringify(sellerFractionData, null, 2));

    // Update trade status
    tradeData.status = 'accepted';
    tradeData.acceptedBy = interaction.user.tag;
    tradeData.acceptedAt = new Date().toISOString();
    fs.writeFileSync(tradePath, JSON.stringify(tradeData, null, 2));

    // Update message
    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0x00FF00)
        .setTitle('✅ Obchodní nabídka přijata')
        .addFields(
            { name: 'Přijal', value: interaction.user.tag, inline: true },
            { name: 'Stav peněz', value: `Prodávající: ${sellerFractionData.money}$\nKupující: ${buyerFractionData.money}$` }
        );

    await interaction.message.edit({
        embeds: [updatedEmbed],
        components: []
    });

    await interaction.followUp({
        content: `✅ Obchodní nabídka byla úspěšně přijata a zpracována.`,
        ephemeral: true
    });
}

async function transferTradeItems(tradeData) {
    const { buyer, seller, item, count } = tradeData;
    const fractionPath = path.join(__dirname, '../../files/Fractions');
    
    // Get item paths
    const sellerItemPath = path.join(fractionPath, seller, item.section, item.file);
    const sellerSectionPath = path.join(fractionPath, seller, item.section);
    const buyerSectionPath = path.join(fractionPath, buyer, item.section);
    
    if (!fs.existsSync(buyerSectionPath)) {
        fs.mkdirSync(buyerSectionPath, { recursive: true });
    }

    const sellerItem = JSON.parse(fs.readFileSync(sellerItemPath, 'utf8'));

    if (item.type === 'countable') {
        // Update seller's item
        if (sellerItem.count === count) {
            fs.unlinkSync(sellerItemPath);
            
            // Check if seller's section is empty and remove if it is
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

        // Check if buyer already has this item
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
        // For non-countable items, move the file
        fs.renameSync(sellerItemPath, path.join(buyerSectionPath, item.file));
        
        // Check if seller's section is empty and remove if it is
        const remainingFiles = fs.readdirSync(sellerSectionPath)
            .filter(file => file.endsWith('.json'));
        if (remainingFiles.length === 0) {
            fs.rmdirSync(sellerSectionPath);
            console.log('Removed empty section directory:', sellerSectionPath);
        }
    }
}

module.exports = { handleTradeResponse };