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

/* ================= CONFIG ================= */

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 10000;

// Painel Presença
const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_RELATORIO_PRESENCA_ID = '1458342162981716039';

// Ticket
const CANAL_ABRIR_TICKET_ID = '1463407852583653479';
const CANAL_TRANSCRIPT_ID = '1463408206129664128';

// Cargos
const CARGO_TELEFONISTA_ID = '1463421663101059154';
const CARGO_STAFF_ID = '838753379332915280';

// Telefones
const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];

/* ================= ESTADOS ================= */

const estadoTelefones = {};
const atendimentosAtivos = new Map();
const relatorioDiario = {};
let mensagemPainelId = null;
let mensagemRelatorioId = null;

const ticketsAbertos = new Map();

/* ================= UTILS ================= */

const hoje = () => new Date().toLocaleDateString('pt-BR');
const hora = () => new Date().toLocaleTimeString('pt-BR');
const tempo = entrada => {
  const min = Math.floor((Date.now() - entrada) / 60000);
  return `${Math.floor(min / 60)}h ${min % 60}min`;
};

/* ================= CLIENT ================= */

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

/* ================= RELATÓRIO ================= */

async function registrarEvento(telefone, texto) {
  const data = hoje();
  if (!relatorioDiario[data]) relatorioDiario[data] = {};
  if (!relatorioDiario[data][telefone]) relatorioDiario[data][telefone] = [];
  relatorioDiario[data][telefone].push(texto);
}

/* ================= PAINEL PRESENÇA ================= */

async function atualizarPainel() {
  const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID);

  const status = telefones.map(t =>
    estadoTelefones[t]
      ? `🔴 Telefone ${t} — ${estadoTelefones[t].nome}`
      : `🟢 Telefone ${t} — Livre`
  ).join('\n');

  const botoes = telefones.map(t =>
    new ButtonBuilder()
      .setCustomId(`entrar_${t}`)
      .setLabel(`📞 ${t}`)
      .setStyle(ButtonStyle.Success)
  );

  const rows = [];
  for (let i = 0; i < botoes.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(botoes.slice(i, i + 5)));
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
    const msg = await canal.messages.fetch(mensagemPainelId).catch(() => null);
    if (msg) return msg.edit({ content: texto, components: rows });
  }

  const msg = await canal.send({ content: texto, components: rows });
  mensagemPainelId = msg.id;
}

/* ================= PAINEL TICKET ================= */

async function criarPainelTicket() {
  const canal = await client.channels.fetch(CANAL_ABRIR_TICKET_ID);

  const botao = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('abrir_ticket')
      .setLabel('🎫 Iniciar Atendimento')
      .setStyle(ButtonStyle.Primary)
  );

  await canal.send({
    content: '🎧 **PAINEL DE ATENDIMENTO**\n\nClique para abrir seu ticket.',
    components: [botao]
  });
}

/* ================= READY ================= */

client.once('ready', async () => {
  console.log('✅ Bot online');
  await atualizarPainel();
  await criarPainelTicket();
});

/* ================= INTERACTIONS ================= */

client.on('interactionCreate', async interaction => {
  try {

    /* ===== PAINEL PRESENÇA ===== */

    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      await interaction.deferReply({ flags: 64 });
      const telefone = interaction.customId.replace('entrar_', '');

      if (estadoTelefones[telefone]) {
        return interaction.editReply('⚠️ Telefone ocupado.');
      }

      estadoTelefones[telefone] = {
        userId: interaction.user.id,
        nome: interaction.user.username,
        entrada: new Date()
      };

      if (!atendimentosAtivos.has(interaction.user.id)) {
        atendimentosAtivos.set(interaction.user.id, []);
      }
      atendimentosAtivos.get(interaction.user.id).push(telefone);

      await atualizarPainel();
      return interaction.editReply(`📞 Conectado ao telefone **${telefone}**`);
    }

    if (interaction.isButton() && interaction.customId === 'sair_todos') {
      await interaction.deferReply({ flags: 64 });

      const lista = atendimentosAtivos.get(interaction.user.id) || [];
      for (const tel of lista) delete estadoTelefones[tel];
      atendimentosAtivos.delete(interaction.user.id);

      await atualizarPainel();
      return interaction.editReply('📴 Desconectado de todos.');
    }

    // 🔧 HANDLERS VAZIOS PARA NÃO DAR "INTERAÇÃO FALHOU"
    if (interaction.isButton() && ['menu_sair', 'menu_forcar'].includes(interaction.customId)) {
      return interaction.reply({ content: '⚙️ Em ajuste.', flags: 64 });
    }

    /* ===== TICKET ===== */

    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      await interaction.deferReply({ flags: 64 });

      if (!interaction.member.roles.cache.has(CARGO_TELEFONISTA_ID)) {
        return interaction.editReply('❌ Apenas telefonistas.');
      }

      if (ticketsAbertos.has(interaction.user.id)) {
        return interaction.editReply('⚠️ Você já possui ticket.');
      }

      const canal = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}-online`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
          { id: CARGO_STAFF_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
      });

      ticketsAbertos.set(interaction.user.id, canal.id);
      await canal.send('🎫 Ticket aberto.');
      return interaction.editReply(`✅ Ticket criado: ${canal}`);
    }

  } catch (e) {
    console.error('ERRO INTERACTION:', e);
  }
});

/* ================= START ================= */

client.login(TOKEN);

http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot rodando');
}).listen(PORT);
