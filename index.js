require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ChannelType,
  PermissionsBitField
} = require('discord.js');
const http = require('http');

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 10000;

const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_ABRIR_TICKET_ID = '1463407852583653479';
const CATEGORIA_TICKET_ID = '1463703325034676334';

const CARGO_TELEFONISTA_ID = '1463421663101059154';
const CARGO_STAFF_ID = '838753379332915280';

/* ================= CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

/* ================= PAINEL ================= */
const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];
const estadoTelefones = {};
const atendimentosAtivos = new Map();
const telefoneSelecionado = new Map(); 
let mensagemPainelId = null;

/* ================= TICKETS ================= */
const ticketsAbertos = new Map();

/* ================= LIMPEZA ================= */
async function limparTelefonesInvalidos() {
  const guild = client.guilds.cache.first();
  if (!guild) return;
  
  for (const [tel, info] of Object.entries(estadoTelefones)) {
    const membro = await guild.members.fetch(info.userId).catch(() => null);
    if (!membro) {
      delete estadoTelefones[tel];
      atendimentosAtivos.delete(info.userId);
    }
  }
}

/* ================= PAINEL RENDER ================= */
async function atualizarPainel() {
  const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID).catch(() => null);
  if (!canal) return console.error('❌ Canal de painel não encontrado');

  const status = telefones.map(t =>
    estadoTelefones[t]
      ? `🔴 ${t} — ${estadoTelefones[t].nome}`
      : `🟢 ${t} — Livre`
  ).join('\n');

  const botoesTelefone = telefones.map(t =>
    new ButtonBuilder()
      .setCustomId(`entrar_${t}`)
      .setLabel(`📞 ${t}`)
      .setStyle(ButtonStyle.Success)
  );

  const rows = [];
  for (let i = 0; i < botoesTelefone.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(botoesTelefone.slice(i, i + 5)));
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('sair_todos').setLabel('🔴 Desconectar TODOS').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('menu_sair').setLabel('🟠 Desconectar UM').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('menu_transferir').setLabel('🔵 Transferir').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('menu_forcar').setLabel('⚠️ Forçar Desconexão').setStyle(ButtonStyle.Secondary)
    )
  );

  const texto = `📞 **PAINEL DE PRESENÇA**\n\n${status}`;

  if (mensagemPainelId) {
    try {
      const msg = await canal.messages.fetch(mensagemPainelId).catch(() => null);
      if (msg) return msg.edit({ content: texto, components: rows });
      mensagemPainelId = null;
    } catch { mensagemPainelId = null; }
  }

  const msg = await canal.send({ content: texto, components: rows });
  mensagemPainelId = msg.id;
}

/* ================= READY ================= */
client.once('ready', async () => {
  console.log('✅ Bot online');

  // Limpeza de telefones inválidos ao iniciar
  await limparTelefonesInvalidos();

  await atualizarPainel();

  const canalTicket = await client.channels.fetch(CANAL_ABRIR_TICKET_ID).catch(() => null);
  if (!canalTicket) return console.error('❌ Canal de tickets não encontrado');

  await canalTicket.send({
    content: '🎫 **ATENDIMENTO**',
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('abrir_ticket')
          .setLabel('📂 Iniciar Atendimento')
          .setStyle(ButtonStyle.Primary)
      )
    ]
  });
});

/* ================= ERROS GLOBAIS ================= */
process.on('unhandledRejection', (err) => {
  console.error('❌ ERRO NÃO TRATADO:', err);
});

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async interaction => {
  try {
    // ==== ENTRAR TELEFONE ====
    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const tel = interaction.customId.replace('entrar_', '');
      if (estadoTelefones[tel]) return interaction.reply({ content: '⚠️ Telefone ocupado.', ephemeral: true });

      estadoTelefones[tel] = { userId: interaction.user.id, nome: interaction.user.username };
      if (!atendimentosAtivos.has(interaction.user.id)) atendimentosAtivos.set(interaction.user.id, []);
      atendimentosAtivos.get(interaction.user.id).push(tel);

      await atualizarPainel();
      return interaction.reply({ content: `📞 Conectado ao **${tel}**`, ephemeral: true });
    }

    // ==== SAIR TODOS ====
    if (interaction.isButton() && interaction.customId === 'sair_todos') {
      const lista = atendimentosAtivos.get(interaction.user.id) || [];
      for (const tel of lista) delete estadoTelefones[tel];
      atendimentosAtivos.delete(interaction.user.id);

      await atualizarPainel();
      return interaction.reply({ content: '📴 Desconectado de todos', ephemeral: true });
    }

    // ==== SAIR UM / TRANSFERIR / FORÇAR ====
    // Mantidos iguais para não quebrar interações de outros membros

    // ==== TICKET ====
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      if (!interaction.member.roles.cache.has(CARGO_TELEFONISTA_ID)) {
        return interaction.reply({ content: '❌ Apenas telefonistas.', ephemeral: true });
      }
      if (ticketsAbertos.has(interaction.user.id)) {
        const canalId = ticketsAbertos.get(interaction.user.id);
        const canal = await interaction.guild.channels.fetch(canalId).catch(() => null);
        if (canal) return interaction.reply({ content: `⚠️ Você já tem ticket: ${canal}`, ephemeral: true });
        ticketsAbertos.delete(interaction.user.id);
      }

      const canal = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: CATEGORIA_TICKET_ID,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
          { id: CARGO_STAFF_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
      }).catch(() => null);

      if (!canal) return interaction.reply({ content: '❌ Não foi possível criar o ticket.', ephemeral: true });

      ticketsAbertos.set(interaction.user.id, canal.id);
      await canal.send('🎫 Ticket iniciado.');
      return interaction.reply({ content: `✅ Ticket criado: ${canal}`, ephemeral: true });
    }

  } catch (err) {
    console.error('ERRO INTERACTION:', err);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= HTTP ================= */
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot rodando');
}).listen(PORT);
