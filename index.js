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

/* ================= PAINEL DE PRESENÇA ================= */

const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_RELATORIO_PRESENCA_ID = '1458342162981716039';

const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];

const estadoTelefones = {};
const atendimentosAtivos = new Map();
const relatorioDiario = {};
let mensagemPainelId = null;
let mensagemRelatorioId = null;

/* ================= SISTEMA DE TICKET ================= */

const CANAL_ABRIR_TICKET_ID = '1463407852583653479';
const CANAL_TRANSCRIPT_ID = '1463408206129664128';

const CARGO_TELEFONISTA_ID = '1463421663101059154';
const CARGO_STAFF_ID = '838753379332915280';

const ticketsAbertos = new Map(); // userId => channelId

/* ================= UTIL ================= */

const hoje = () => new Date().toLocaleDateString('pt-BR');
const hora = () => new Date().toLocaleTimeString('pt-BR');

const tempo = entrada => {
  const min = Math.floor((Date.now() - entrada) / 60000);
  return `${Math.floor(min / 60)}h ${min % 60}min`;
};

/* ================= CLIENT ================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

/* ================= RELATÓRIO PRESENÇA ================= */

async function atualizarRelatorio() {
  const canal = await client.channels.fetch(CANAL_RELATORIO_PRESENCA_ID);
  const data = hoje();
  if (!relatorioDiario[data]) return;

  let texto = `📅 **RELATÓRIO DIÁRIO — ${data}**\n\n`;

  for (const tel of Object.keys(relatorioDiario[data])) {
    texto += `📞 **Telefone ${tel}**\n`;
    texto += relatorioDiario[data][tel].join('\n');
    texto += `\n----------------------\n`;
  }

  if (mensagemRelatorioId) {
    const msg = await canal.messages.fetch(mensagemRelatorioId).catch(() => null);
    if (msg) await msg.edit(texto);
    else mensagemRelatorioId = (await canal.send(texto)).id;
  } else {
    mensagemRelatorioId = (await canal.send(texto)).id;
  }
}

async function registrarEvento(telefone, texto) {
  const data = hoje();
  if (!relatorioDiario[data]) relatorioDiario[data] = {};
  if (!relatorioDiario[data][telefone]) relatorioDiario[data][telefone] = [];
  relatorioDiario[data][telefone].push(texto);
  await atualizarRelatorio();
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
      new ButtonBuilder().setCustomId('menu_forcar').setLabel('⚠️ Forçar').setStyle(ButtonStyle.Secondary)
    )
  );

  const texto = `📞 **PAINEL DE PRESENÇA**\n\n${status}`;

  if (mensagemPainelId) {
    const msg = await canal.messages.fetch(mensagemPainelId).catch(() => null);
    if (msg) await msg.edit({ content: texto, components: rows });
    else mensagemPainelId = (await canal.send({ content: texto, components: rows })).id;
  } else {
    mensagemPainelId = (await canal.send({ content: texto, components: rows })).id;
  }
}

/* ================= READY ================= */

client.once('ready', async () => {
  console.log('✅ Bot online');
  await atualizarPainel();

  const canalTicket = await client.channels.fetch(CANAL_ABRIR_TICKET_ID);
  await canalTicket.send({
    content: '🎫 **Sistema de Ticket**',
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_abrir')
          .setLabel('📞 Iniciar Atendimento')
          .setStyle(ButtonStyle.Primary)
      )
    ]
  });
});

/* ================= INTERAÇÕES ================= */

client.on('interactionCreate', async interaction => {

  /* ===== ABRIR TICKET ===== */
  if (interaction.isButton() && interaction.customId === 'ticket_abrir') {

    if (!interaction.member.roles.cache.has(CARGO_TELEFONISTA_ID))
      return interaction.reply({ content: '⛔ Apenas telefonista.', ephemeral: true });

    if (ticketsAbertos.has(interaction.user.id))
      return interaction.reply({ content: '⚠️ Você já tem ticket aberto.', ephemeral: true });

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

    await canal.send({
      content: `📞 Atendimento iniciado por **${interaction.user.username}**`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ticket_fechar').setLabel('🔒 Fechar').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('ticket_excluir').setLabel('🗑️ Excluir').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('ticket_salvar').setLabel('💾 Salvar').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('ticket_reabrir').setLabel('🔓 Reabrir').setStyle(ButtonStyle.Primary)
        )
      ]
    });

    return interaction.reply({ content: '✅ Ticket criado.', ephemeral: true });
  }

  /* ===== FECHAR ===== */
  if (interaction.isButton() && interaction.customId === 'ticket_fechar') {
    await interaction.channel.setName(interaction.channel.name.replace('online', 'offline'));
    await interaction.channel.permissionOverwrites.edit(interaction.user.id, { SendMessages: false });
    return interaction.reply({ content: '🔒 Ticket fechado.', ephemeral: true });
  }

  /* ===== EXCLUIR ===== */
  if (interaction.isButton() && interaction.customId === 'ticket_excluir') {
    ticketsAbertos.delete(interaction.user.id);
    await interaction.channel.delete();
  }

  /* ===== SALVAR ===== */
  if (interaction.isButton() && interaction.customId === 'ticket_salvar') {

    if (!interaction.member.roles.cache.has(CARGO_STAFF_ID))
      return interaction.reply({ content: '⛔ Apenas staff.', ephemeral: true });

    const canalTranscript = await client.channels.fetch(CANAL_TRANSCRIPT_ID);
    await canalTranscript.send(`📄 Ticket salvo: ${interaction.channel.name}`);

    const donoId = [...ticketsAbertos.entries()].find(([, c]) => c === interaction.channel.id)?.[0];
    if (donoId) {
      const user = await client.users.fetch(donoId);
      await user.send(`📄 Seu ticket **${interaction.channel.name}** foi salvo.`);
      ticketsAbertos.delete(donoId);
    }

    await interaction.channel.delete();
  }

});

/* ================= LOGIN + HTTP ================= */

client.login(TOKEN);

http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot rodando');
}).listen(PORT);
