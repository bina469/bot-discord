const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  PermissionsBitField,
  ChannelType
} = require('discord.js');

const http = require('http');

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 10000;

/* =======================
   IDs FIXOS
======================= */
const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_RELATORIO_PRESENCA_ID = '1458342162981716039';

const CANAL_ABERTURA_TICKET_ID = '1463407852583653479';
const CANAL_TRANSCRIPT_ID = '1463408206129664128';

/* ROLES (AJUSTE AQUI) */
const ROLE_TELEFONISTA_ID = '1463421663101059154';
const ROLE_STAFF_ID = '838753379332915280';

/* =======================
   PAINEL (NÃO ALTERADO)
======================= */
// >>> SEU CÓDIGO DO PAINEL CONTINUA EXATAMENTE IGUAL <<<
// (mantive fora para não poluir, você já confirmou que este código está estável)

/* =======================
   CLIENT
======================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', async () => {
  console.log('✅ Bot online');
  await enviarPainelTicket();
});

/* =======================
   SISTEMA DE TICKET
======================= */
const ticketsAtivos = new Map(); // userId -> channelId
const infoTickets = {}; // channelId -> dados

async function enviarPainelTicket() {
  const canal = await client.channels.fetch(CANAL_ABERTURA_TICKET_ID);

  const botao = new ButtonBuilder()
    .setCustomId('abrir_ticket')
    .setLabel('🎟️ Iniciar Atendimento')
    .setStyle(ButtonStyle.Success);

  const row = new ActionRowBuilder().addComponents(botao);

  await canal.send({
    content: '🎟️ **SISTEMA DE ATENDIMENTO**\n\nClique abaixo para iniciar um atendimento.',
    components: [row]
  });
}

/* =======================
   INTERAÇÕES
======================= */
client.on('interactionCreate', async interaction => {
  try {

    /* =======================
       ABRIR TICKET
    ======================= */
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      const member = interaction.member;

      if (!member.roles.cache.has(ROLE_TELEFONISTA_ID))
        return interaction.reply({ content: '❌ Você não é telefonista.', ephemeral: true });

      if (ticketsAtivos.has(member.id))
        return interaction.reply({ content: '⚠️ Você já tem um ticket aberto.', ephemeral: true });

      const canal = await interaction.guild.channels.create({
        name: `ticket-${member.user.username}-online`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
          { id: ROLE_STAFF_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
      });

      ticketsAtivos.set(member.id, canal.id);
      infoTickets[canal.id] = {
        dono: member.id,
        status: 'online',
        abertura: new Date()
      };

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('fechar_ticket').setLabel('🔒 Fechar Ticket').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('excluir_ticket').setLabel('🗑️ Excluir Ticket').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('salvar_ticket').setLabel('💾 Salvar Ticket').setStyle(ButtonStyle.Primary)
      );

      await canal.send({
        content: `📞 Atendimento iniciado por <@${member.id}>\nStatus: 🟢 ONLINE`,
        components: [row]
      });

      await interaction.reply({ content: '✅ Ticket criado.', ephemeral: true });
    }

    /* =======================
       FECHAR TICKET
    ======================= */
    if (interaction.isButton() && interaction.customId === 'fechar_ticket') {
      const canal = interaction.channel;
      const info = infoTickets[canal.id];
      if (!info) return;

      if (interaction.user.id !== info.dono)
        return interaction.reply({ content: '❌ Apenas o dono pode fechar.', ephemeral: true });

      await canal.setName(canal.name.replace('-online', '-offline'));
      await canal.permissionOverwrites.edit(info.dono, { SendMessages: false });

      info.status = 'offline';
      info.fechamento = new Date();

      await interaction.reply({ content: '🔒 Ticket fechado.', ephemeral: true });
    }

    /* =======================
       SALVAR TICKET (STAFF)
    ======================= */
    if (interaction.isButton() && interaction.customId === 'salvar_ticket') {
      if (!interaction.member.roles.cache.has(ROLE_STAFF_ID))
        return interaction.reply({ content: '❌ Apenas staff.', ephemeral: true });

      const canal = interaction.channel;
      const mensagens = await canal.messages.fetch({ limit: 100 });
      const texto = mensagens
        .reverse()
        .map(m => `[${m.author.username}] ${m.content}`)
        .join('\n');

      const canalTranscript = await client.channels.fetch(CANAL_TRANSCRIPT_ID);
      await canalTranscript.send(`📄 **TRANSCRIPT — ${canal.name}**\n\n${texto}`);

      const dono = infoTickets[canal.id].dono;
      const user = await client.users.fetch(dono);

      await user.send('📄 Seu ticket foi salvo pelo staff.');

      ticketsAtivos.delete(dono);
      delete infoTickets[canal.id];

      await canal.delete();
    }

    /* =======================
       EXCLUIR TICKET
    ======================= */
    if (interaction.isButton() && interaction.customId === 'excluir_ticket') {
      const info = infoTickets[interaction.channel.id];
      if (!info) return;

      if (interaction.user.id !== info.dono)
        return interaction.reply({ content: '❌ Apenas o dono.', ephemeral: true });

      ticketsAtivos.delete(info.dono);
      delete infoTickets[interaction.channel.id];

      await interaction.channel.delete();
    }

  } catch (err) {
    console.error('ERRO TICKET:', err);
  }
});

/* =======================
   LOGIN + HTTP
======================= */
client.login(TOKEN);

http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot rodando');
}).listen(PORT, () => console.log(`Servidor ouvindo na porta ${PORT}`));
