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

// CANAIS
const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_RELATORIO_PRESENCA_ID = '1458342162981716039';
const CANAL_ABERTURA_TICKET_ID = '1463407852583653479';
const CANAL_TRANSCRIPT_ID = '1463408206129664128';

// CARGOS
const CARGO_TELEFONISTA_ID = '1463421663101059154';
const CARGO_STAFF_ID = '838753379332915280';

// TELEFONES
const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];

// ===== ESTADO =====
const estadoTelefones = {};
const atendimentosAtivos = new Map();
const relatorioDiario = {};
let mensagemPainelId = null;
let mensagemRelatorioId = null;

// TICKETS
const ticketsAbertos = new Map(); // userId -> channelId

// ===== UTILS =====
const hoje = () => new Date().toLocaleDateString('pt-BR');
const hora = () => new Date().toLocaleTimeString('pt-BR');
const tempo = entrada => {
  const min = Math.floor((Date.now() - entrada) / 60000);
  return `${Math.floor(min / 60)}h ${min % 60}min`;
};

// ===== RELATÓRIO =====
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

async function registrarEvento(tel, texto) {
  const data = hoje();
  if (!relatorioDiario[data]) relatorioDiario[data] = {};
  if (!relatorioDiario[data][tel]) relatorioDiario[data][tel] = [];
  relatorioDiario[data][tel].push(texto);
  await atualizarRelatorio();
}

// ===== PAINEL =====
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
    if (msg) await msg.edit({ content: texto, components: rows });
    else mensagemPainelId = (await canal.send({ content: texto, components: rows })).id;
  } else {
    mensagemPainelId = (await canal.send({ content: texto, components: rows })).id;
  }
}

// ===== CLIENT =====
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log('✅ Bot online');
  await atualizarPainel();

  // PAINEL DE TICKET
  const canalTicket = await client.channels.fetch(CANAL_ABERTURA_TICKET_ID);
  await canalTicket.send({
    content: '🎫 **ABERTURA DE TICKET**\nSomente telefonistas podem abrir.',
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('abrir_ticket')
          .setLabel('🎧 Iniciar Atendimento')
          .setStyle(ButtonStyle.Primary)
      )
    ]
  });
});

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {
  const user = interaction.user;

  try {
    // ===== ENTRAR TELEFONE =====
    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      await interaction.deferReply({ ephemeral: true });

      const tel = interaction.customId.replace('entrar_', '');
      if (estadoTelefones[tel]) return interaction.editReply('⚠️ Ocupado.');

      estadoTelefones[tel] = { userId: user.id, nome: user.username, entrada: new Date() };
      if (!atendimentosAtivos.has(user.id)) atendimentosAtivos.set(user.id, []);
      atendimentosAtivos.get(user.id).push(tel);

      await registrarEvento(tel, `🟢 ${hora()} — ${user.username} conectou`);
      await atualizarPainel();
      return interaction.editReply(`📞 Conectado ao **${tel}**`);
    }

    // ===== DESCONEXÃO / MENUS =====
    if (interaction.isButton() && interaction.customId === 'menu_sair') {
      const lista = atendimentosAtivos.get(user.id) || [];
      if (!lista.length) return interaction.reply({ content: '⚠️ Nenhum telefone.', ephemeral: true });

      const menu = new StringSelectMenuBuilder()
        .setCustomId('sair_um')
        .addOptions(lista.map(t => ({ label: t, value: t })));

      return interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'sair_um') {
      const tel = interaction.values[0];
      const dados = estadoTelefones[tel];

      await registrarEvento(tel, `🔴 ${hora()} — ${dados.nome} saiu (${tempo(dados.entrada)})`);
      delete estadoTelefones[tel];
      atendimentosAtivos.set(user.id, atendimentosAtivos.get(user.id).filter(t => t !== tel));

      await atualizarPainel();
      return interaction.update({ content: `✅ ${tel} desconectado`, components: [] });
    }

    // ===== TICKET =====
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      await interaction.deferReply({ ephemeral: true });

      const member = interaction.member;
      if (!member.roles.cache.has(CARGO_TELEFONISTA_ID))
        return interaction.editReply('❌ Apenas telefonistas.');

      if (ticketsAbertos.has(user.id))
        return interaction.editReply('⚠️ Você já tem um ticket.');

      const canal = await interaction.guild.channels.create({
        name: `ticket-${user.username}-online`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
          { id: CARGO_STAFF_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
      });

      ticketsAbertos.set(user.id, canal.id);
      await canal.send(`📞 Atendimento iniciado por **${user.username}**`);
      return interaction.editReply(`✅ Ticket criado: ${canal}`);
    }

  } catch (e) {
    console.error('ERRO INTERACTION:', e);
  }
});

client.login(TOKEN);

// ===== HTTP =====
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot rodando');
}).listen(PORT);
