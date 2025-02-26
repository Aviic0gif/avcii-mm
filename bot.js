const { Client, GatewayIntentBits, Partials, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

// Create a simple database structure
let database = {
  transactions: {}
};

// Load database if exists
const dbPath = path.join(__dirname, 'database.json');
if (fs.existsSync(dbPath)) {
  try {
    database = JSON.parse(fs.readFileSync(dbPath));
  } catch (error) {
    console.error('Error loading database:', error);
  }
}

// Save database function
function saveDatabase() {
  fs.writeFileSync(dbPath, JSON.stringify(database, null, 2));
}

// Create client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// Setup collections
client.commands = new Collection();
client.cooldowns = new Collection();
client.activeTransactions = new Collection();
client.database = database;
client.saveDatabase = saveDatabase;

// Define commands
const createTransactionCommand = {
  data: new SlashCommandBuilder()
    .setName('create')
    .setDescription('Create a new middleman transaction')
    .addSubcommand(subcommand =>
      subcommand
        .setName('crypto')
        .setDescription('Create a cryptocurrency transaction')
        .addUserOption(option => 
          option.setName('user')
            .setDescription('The user you are trading with')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('amount')
            .setDescription('Amount of cryptocurrency')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('currency')
            .setDescription('Currency type (BTC, ETH, etc.)')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('details')
            .setDescription('Additional transaction details')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('game')
        .setDescription('Create an in-game items transaction')
        .addUserOption(option => 
          option.setName('user')
            .setDescription('The user you are trading with')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('game')
            .setDescription('The game you are trading in')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('items')
            .setDescription('Description of items being traded')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('details')
            .setDescription('Additional transaction details')
            .setRequired(false))),
  async execute(interaction, client) {
    // Generate a unique transaction ID
    const transactionId = crypto.randomBytes(4).toString('hex');
    
    // Get common parameters
    const targetUser = interaction.options.getUser('user');
    const subcommand = interaction.options.getSubcommand();
    const details = interaction.options.getString('details') || 'No additional details provided';
    
    // Prevent transactions with self
    if (targetUser.id === interaction.user.id) {
      return interaction.reply({ content: 'You cannot create a transaction with yourself.', ephemeral: true });
    }
    
    // Prevent transactions with bots
    if (targetUser.bot) {
      return interaction.reply({ content: 'You cannot create a transaction with a bot.', ephemeral: true });
    }
    
    // Create transaction object based on type
    let transaction = {
      id: transactionId,
      initiator: interaction.user.id,
      recipient: targetUser.id,
      createdAt: Date.now(),
      status: 'pending',
      initiatorConfirmed: false,
      recipientConfirmed: false,
      details: details,
    };
    
    let descriptionText = '';
    
    if (subcommand === 'crypto') {
      const amount = interaction.options.getString('amount');
      const currency = interaction.options.getString('currency').toUpperCase();
      
      transaction.type = 'crypto';
      transaction.amount = amount;
      transaction.currency = currency;
      
      descriptionText = `${interaction.user} wants to trade ${amount} ${currency} with ${targetUser}`;
    } else { // game
      const game = interaction.options.getString('game');
      const items = interaction.options.getString('items');
      
      transaction.type = 'ingame';
      transaction.game = game;
      transaction.items = items;
      
      descriptionText = `${interaction.user} wants to trade items in ${game} with ${targetUser}`;
    }
    
    // Save transaction to database
    client.database.transactions[transactionId] = transaction;
    client.saveDatabase();
    
    // Add to active transactions
    client.activeTransactions.set(transactionId, transaction);
    
    // Create confirmation message
    const transactionEmbed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`Transaction #${transactionId}`)
      .setDescription(descriptionText)
      .addFields(
        { name: 'Seller', value: `${interaction.user.tag}`, inline: true },
        { name: 'Buyer', value: `${targetUser.tag}`, inline: true },
        { name: 'Type', value: subcommand, inline: true }
      )
      .setTimestamp();
    
    // Add type-specific fields
    if (subcommand === 'crypto') {
      transactionEmbed.addFields(
        { name: 'Amount', value: transaction.amount, inline: true },
        { name: 'Currency', value: transaction.currency, inline: true }
      );
    } else { // game
      transactionEmbed.addFields(
        { name: 'Game', value: transaction.game, inline: true },
        { name: 'Items', value: transaction.items, inline: true }
      );
    }
    
    // Add details and status
    transactionEmbed.addFields(
      { name: 'Additional Details', value: details, inline: false },
      { name: 'Status', value: 'Waiting for confirmation from both parties', inline: false }
    );
    
    // Create buttons
    const buttons = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_${transactionId}`)
          .setLabel('Confirm')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`cancel_${transactionId}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Danger)
      );
    
    // Send the transaction message
    await interaction.reply({ embeds: [transactionEmbed], components: [buttons] });
    
    // DM the other user
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`New Transaction Request #${transactionId}`)
        .setDescription(`${interaction.user.tag} wants to make a trade with you.`)
        .addFields(
          { name: 'Type', value: subcommand, inline: true },
          { name: 'Details', value: `Please check the channel where the transaction was created to confirm or cancel.`, inline: false }
        )
        .setTimestamp();
      
      await targetUser.send({ embeds: [dmEmbed] });
    } catch (error) {
      console.error(`Could not send DM to ${targetUser.tag}:`, error);
      await interaction.followUp({ content: `I couldn't send a direct message to ${targetUser}. They may have DMs disabled.`, ephemeral: true });
    }
  },
};

const listTransactionsCommand = {
  data: new SlashCommandBuilder()
    .setName('transactions')
    .setDescription('List your active or past transactions')
    .addStringOption(option =>
      option.setName('status')
        .setDescription('Filter transactions by status')
        .setRequired(false)
        .addChoices(
          { name: 'Active', value: 'active' },
          { name: 'Completed', value: 'completed' },
          { name: 'Cancelled', value: 'cancelled' },
          { name: 'All', value: 'all' }
        )),
  async execute(interaction, client) {
    await interaction.deferReply({ ephemeral: true });
    
    const userId = interaction.user.id;
    const statusFilter = interaction.options.getString('status') || 'active';
    
    const { transactions } = client.database;
    
    // Filter transactions involving the user
    const userTransactions = Object.values(transactions).filter(tx => {
      const isUserInvolved = tx.initiator === userId || tx.recipient === userId;
      
      if (!isUserInvolved) return false;
      
      if (statusFilter === 'all') return true;
      if (statusFilter === 'active') return tx.status === 'pending' || tx.status === 'escrow';
      if (statusFilter === 'completed') return tx.status === 'completed';
      if (statusFilter === 'cancelled') return tx.status === 'cancelled';
      
      return true;
    });
    
    if (userTransactions.length === 0) {
      return interaction.editReply(`You don't have any ${statusFilter !== 'all' ? statusFilter : ''} transactions.`);
    }
    
    // Sort transactions by creation date (newest first)
    userTransactions.sort((a, b) => b.createdAt - a.createdAt);
    
    // Create embed for transactions list
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`Your ${statusFilter !== 'all' ? statusFilter : ''} Transactions`)
      .setDescription(`Found ${userTransactions.length} transaction(s)`)
      .setTimestamp();
    
    // Add each transaction to the embed (limit to 10 for readability)
    const maxDisplay = Math.min(userTransactions.length, 10);
    for (let i = 0; i < maxDisplay; i++) {
      const tx = userTransactions[i];
      const otherUserId = tx.initiator === userId ? tx.recipient : tx.initiator;
      let otherUserTag;
      
      try {
        const otherUser = await client.users.fetch(otherUserId);
        otherUserTag = otherUser.tag;
      } catch (error) {
        otherUserTag = 'Unknown User';
      }
      
      const role = tx.initiator === userId ? 'Seller' : 'Buyer';
      const createdDate = new Date(tx.createdAt).toLocaleString();
      const txType = tx.type === 'crypto' 
        ? `${tx.amount} ${tx.currency}`
        : `${tx.game} items`;
      
      embed.addFields({
        name: `Transaction #${tx.id} (${tx.status.toUpperCase()})`,
        value: `
          **Type:** ${tx.type}
          **${role} (You)** trading with **${otherUserTag}**
          **Details:** ${txType}
          **Created:** ${createdDate}
        `,
        inline: false
      });
    }
    
    if (userTransactions.length > 10) {
      embed.setFooter({ text: `Showing 10 of ${userTransactions.length} transactions. Use /transaction info [id] for details.` });
    }
    
    await interaction.editReply({ embeds: [embed] });
  },
};

const transactionInfoCommand = {
  data: new SlashCommandBuilder()
    .setName('transaction')
    .setDescription('Get information about a specific transaction')
    .addStringOption(option =>
      option.setName('id')
        .setDescription('The transaction ID')
        .setRequired(true)),
  async execute(interaction, client) {
    const transactionId = interaction.options.getString('id');
    const userId = interaction.user.id;
    
    // Get transaction from database
    const transaction = client.database.transactions[transactionId];
    
    if (!transaction) {
      return interaction.reply({ content: `Transaction #${transactionId} was not found.`, ephemeral: true });
    }
    
    // Check if user is involved in the transaction
    const isUserInvolved = transaction.initiator === userId || transaction.recipient === userId;
    const isAdmin = interaction.member.permissions.has('ADMINISTRATOR');
    
    if (!isUserInvolved && !isAdmin) {
      return interaction.reply({ content: 'You do not have permission to view this transaction.', ephemeral: true });
    }
    
    // Fetch user information
    const initiatorUser = await client.users.fetch(transaction.initiator).catch(() => null);
    const recipientUser = await client.users.fetch(transaction.recipient).catch(() => null);
    
    // Create embed
    const embed = new EmbedBuilder()
      .setColor(getStatusColor(transaction.status))
      .setTitle(`Transaction #${transactionId}`)
      .setDescription(`Detailed information about this transaction`)
      .addFields(
        { name: 'Status', value: formatStatus(transaction.status), inline: false },
        { name: 'Type', value: transaction.type, inline: true },
        { name: 'Seller', value: initiatorUser ? initiatorUser.tag : 'Unknown User', inline: true },
        { name: 'Buyer', value: recipientUser ? recipientUser.tag : 'Unknown User', inline: true },
        { name: 'Created', value: new Date(transaction.createdAt).toLocaleString(), inline: true }
      );
    
    // Add type-specific fields
    if (transaction.type === 'crypto') {
      embed.addFields(
        { name: 'Amount', value: transaction.amount, inline: true },
        { name: 'Currency', value: transaction.currency, inline: true }
      );
    } else { // in-game
      embed.addFields(
        { name: 'Game', value: transaction.game, inline: true },
        { name: 'Items', value: transaction.items, inline: true }
      );
    }
    
    // Add confirmation status if pending
    if (transaction.status === 'pending') {
      embed.addFields(
        { name: 'Seller Confirmed', value: transaction.initiatorConfirmed ? 'Yes' : 'No', inline: true },
        { name: 'Buyer Confirmed', value: transaction.recipientConfirmed ? 'Yes' : 'No', inline: true }
      );
    }
    
    // Add completion/cancellation details
    if (transaction.status === 'completed') {
      embed.addFields(
        { name: 'Completed At', value: new Date(transaction.completedAt).toLocaleString(), inline: true }
      );
    } else if (transaction.status === 'cancelled') {
      const cancelledByUser = await client.users.fetch(transaction.cancelledBy).catch(() => null);
      embed.addFields(
        { name: 'Cancelled By', value: cancelledByUser ? cancelledByUser.tag : 'Unknown User', inline: true },
        { name: 'Reason', value: transaction.cancelReason || 'No reason provided', inline: true }
      );
    }
    
    // Add additional details
    if (transaction.details) {
      embed.addFields({ name: 'Additional Details', value: transaction.details, inline: false });
    }
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

// Add commands to collection
client.commands.set(createTransactionCommand.data.name, createTransactionCommand);
client.commands.set(listTransactionsCommand.data.name, listTransactionsCommand);
client.commands.set(transactionInfoCommand.data.name, transactionInfoCommand);

// Helper functions
function getStatusColor(status) {
  switch (status) {
    case 'pending': return '#0099ff'; // Blue
    case 'escrow': return '#FFA500';  // Orange
    case 'completed': return '#00FF00'; // Green
    case 'cancelled': return '#FF0000'; // Red
    default: return '#808080'; // Gray
  }
}

function formatStatus(status) {
  switch (status) {
    case 'pending': return '⏳ Pending Confirmation';
    case 'escrow': return '🔒 In Escrow';
    case 'completed': return '✅ Completed';
    case 'cancelled': return '❌ Cancelled';
    default: return status;
  }
}

// Event handlers
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  client.user.setActivity('to your transactions', { type: ActivityType.Listening });
});

client.on('interactionCreate', async interaction => {
  // Handle slash commands
  if (interaction.isCommand()) {
    const command = client.commands.get(interaction.commandName);
    
    if (!command) return;
    
    try {
      await command.execute(interaction, client);
    } catch (error) {
      console.error(error);
      await interaction.reply({ 
        content: 'There was an error executing this command!', 
        ephemeral: true 
      });
    }
  }
  
  // Handle button interactions
  if (interaction.isButton()) {
    const [action, transactionId] = interaction.customId.split('_');
    const transaction = client.database.transactions[transactionId];
    
    if (!transaction) {
      return interaction.reply({ content: 'This transaction no longer exists.', ephemeral: true });
    }
    
    const userId = interaction.user.id;
    const isInitiator = transaction.initiator === userId;
    const isRecipient = transaction.recipient === userId;
    
    if (!isInitiator && !isRecipient) {
      return interaction.reply({ content: 'You are not involved in this transaction.', ephemeral: true });
    }
    
    if (action === 'confirm') {
      if (isInitiator) {
        transaction.initiatorConfirmed = true;
      }
      if (isRecipient) {
        transaction.recipientConfirmed = true;
      }
      
      await interaction.reply({ content: `You have confirmed the transaction #${transactionId}.`, ephemeral: true });
      
      // Check if both parties confirmed
      if (transaction.initiatorConfirmed && transaction.recipientConfirmed) {
        transaction.status = 'escrow';
        transaction.escrowAt = Date.now();
        
        // Notify in the channel
        const embed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle(`Transaction #${transactionId} Update`)
          .setDescription(`Both parties have confirmed! Transaction is now in escrow.`)
          .setTimestamp();
        
        await interaction.channel.send({ embeds: [embed] });
      }
    } else if (action === 'cancel') {
      transaction.status = 'cancelled';
      transaction.cancelledBy = userId;
      transaction.cancelledAt = Date.now();
      
      await interaction.reply(`${interaction.user.tag} has cancelled transaction #${transactionId}.`);
    }
    
    client.database.transactions[transactionId] = transaction;
    client.saveDatabase();
  }
});

// Deploy commands function
async function deployCommands() {
  const { REST } = require('@discordjs/rest');
  const { Routes } = require('discord-api-types/v9');
  
  const commands = [
    createTransactionCommand.data.toJSON(),
    listTransactionsCommand.data.toJSON(),
    transactionInfoCommand.data.toJSON()
  ];
  
  const rest = new REST({ version: '9' }).setToken(process.env.TOKEN);
  
  try {
    console.log('Started refreshing application (/) commands.');
    
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands },
    );
    
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
}

// Check for deploy command
if (process.argv[2] === 'deploy') {
  deployCommands().then(() => process.exit(0));
} else {
  // Login to Discord
  client.login(process.env.TOKEN);
}
