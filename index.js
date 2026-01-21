const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  PermissionFlagsBits,
  ChannelType
} = require('discord.js');

const http = require('http');

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 10000;

const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_RELATORIO_PRESENCA_ID = '1458342162981716039';

// TICKET
const CANAL_ABERTURA_TICKET_ID = '1463407852583653479';
const CANAL_TRANSCRIPT_ID = '1463408206129664128';

// ⚠️ AJUSTE OS IDS DOS CARGOS
const CARGO_TELEFONISTA_ID = '1463421663101059154';
const CARGO_STAFF_ID = '838753379332915280';

// ================= PAINEL (INALTERADO) =================

// Telefone atualizados
const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];

const estadoTelefones = {};
const atendimentosAtivos = new Map();
const relatorioDiario = {};
let mensagemPainelId = null;
let mensagemRelatorioId = null;

function hoje() {
  return new Date().toLocaleDateString('pt-BR');
}
function hora() {
  return new Date().toLocaleTimeString('pt-BR');
}
function tempo(entrada) {
  const min = Math.floor((Date.now() - entrada) / 60000);
  return `${Math.floor(min / 60)}h ${min % 60}min`;
}

async function atualizarRelatorio() {
  try {
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
  } catch (err) {
    console.error('ERRO RELATORIO:', err);
  }
}

async function registrarEvento(telefone, texto) {
  const data = hoje();
  if (!relatorioDiario[data]) relatorioDiario[data] = {};
  if (!relatorioDiario[data][telefone]) relatorioDiario[data][telefone] = [];
  relatorioDiario[data][telefone].push(texto);
  await atualizarRelatorio();
}

async function atualizarPainel() {
  try {
    const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID);

    const status = telefones.map(t =>
      estadoTelefones[t]
        ? `🔴 Telefone ${t} — ${estadoTelefones[t].nome}`
        : `🟢 Telefone ${t} — Livre`
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

    const texto = `📞 **PAINEL DE PRESENÇA**\n\n${status}\n\n👇 Use os botões abaixo`;

    if (mensagemPainelId) {
      const msg = await canal.messages.fetch(mensagemPainelId).catch(() => null);
      if (msg) await msg.edit({ content: texto, components: rows });
      else mensagemPainelId = (await canal.send({ content: texto, components: rows })).id;
    } else {
      mensagemPainelId = (await canal.send({ content: texto, components: rows })).id;
    }
  } catch (err) {
    console.error('ERRO PAINEL:', err);
  }
}

// ================= TICKET =================

const ticketsAbertos = new Map(); // userId -> channelId

async function criarMensagemAberturaTicket() {
  const canal = await client.channels.fetch(CANAL_ABERTURA_TICKET_ID);
  const botao = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('abrir_ticket')
      .setLabel('📩 Iniciar Atendimento')
      .setStyle(ButtonStyle.Success)
  );

  await canal.send({
    content: '📞 **Sistema de Atendimento**\nClique abaixo para iniciar seu ticket.',
    components: [botao]
  });
}

// ================= BOT =================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', async () => {
  console.log('✅ Bot online');
  await atualizarPainel();
  await criarMensagemAberturaTicket();
});

// ================= INTERAÇÕES =================

client.on('interactionCreate', async interaction => {
  try {
    // ===== ABRIR TICKET =====
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      if (!interaction.member.roles.cache.has(CARGO_TELEFONISTA_ID)) {
        return interaction.reply({ content: '❌ Apenas telefonistas podem abrir ticket.', ephemeral: true });
      }

      if (ticketsAbertos.has(interaction.user.id)) {
        return interaction.reply({ content: '⚠️ Você já possui um ticket aberto.', ephemeral: true });
      }

      const canal = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}-online`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
          { id: CARGO_STAFF_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
        ]
      });

      ticketsAbertos.set(interaction.user.id, canal.id);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('fechar_ticket').setLabel('🔒 Fechar').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('salvar_ticket').setLabel('💾 Salvar').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('excluir_ticket').setLabel('🗑 Excluir').setStyle(ButtonStyle.Danger)
      );

      await canal.send({
        content: `📞 Atendimento iniciado por **${interaction.user.username}**`,
        components: [row]
      });

      return interaction.reply({ content: '✅ Ticket criado!', ephemeral: true });
    }

    // ===== FECHAR =====
    if (interaction.isButton() && interaction.customId === 'fechar_ticket') {
      if (!interaction.member.roles.cache.has(CARGO_TELEFONISTA_ID)) return;
      await interaction.channel.setName(interaction.channel.name.replace('-online', '-offline'));
      await interaction.channel.permissionOverwrites.edit(interaction.user.id, { SendMessages: false });
      await interaction.reply({ content: '🔒 Ticket fechado.', ephemeral: true });
    }

    // ===== SALVAR =====
    if (interaction.isButton() && interaction.customId === 'salvar_ticket') {
      if (!interaction.member.roles.cache.has(CARGO_STAFF_ID)) {
        return interaction.reply({ content: '❌ Apenas STAFF.', ephemeral: true });
      }

      const mensagens = await interaction.channel.messages.fetch({ limit: 100 });
      const texto = mensagens
        .reverse()
        .map(m => `[${m.author.username}] ${m.content}`)
        .join('\n');

      const canalTranscript = await client.channels.fetch(CANAL_TRANSCRIPT_ID);
      await canalTranscript.send(`📄 **Transcript**\n\n${texto}`);

      const dono = ticketsAbertos.find((v) => v === interaction.channel.id);
      if (dono) {
        const user = await client.users.fetch(dono[0]);
        await user.send('📄 Seu ticket foi salvo pelo staff.');
        ticketsAbertos.delete(dono[0]);
      }

      await interaction.channel.delete();
    }

    // ===== EXCLUIR =====
    if (interaction.isButton() && interaction.customId === 'excluir_ticket') {
      const dono = ticketsAbertos.find(v => v === interaction.channel.id);
      if (dono) ticketsAbertos.delete(dono[0]);
      await interaction.channel.delete();
    }

  } catch (err) {
    console.error('ERRO INTERACTION:', err);
  }
});

client.login(TOKEN);

// HTTP (Render)
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot rodando');
}).listen(PORT, () => console.log(`Servidor ouvindo na porta ${PORT}`));
