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

// Canais
const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_RELATORIO_PRESENCA_ID = '1458342162981716039';
const CANAL_ABERTURA_TICKET_ID = '1463407852583653479';
const CANAL_TRANSCRIPT_ID = '1463408206129664128';

// Cargos
const CARGO_TELEFONISTA_ID = '1463421663101059154';
const CARGO_STAFF_ID = '838753379332915280';

// Telefones
const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];

// Estado painel
const estadoTelefones = {};
const atendimentosAtivos = new Map();
const relatorioDiario = {};
let mensagemPainelId = null;
let mensagemRelatorioId = null;

// Estado ticket
const ticketsAbertos = new Map(); // userId -> channelId

// Utils
const hoje = () => new Date().toLocaleDateString('pt-BR');
const hora = () => new Date().toLocaleTimeString('pt-BR');
const tempo = entrada => {
  const min = Math.floor((Date.now() - entrada) / 60000);
  return `${Math.floor(min / 60)}h ${min % 60}min`;
};

// ================= RELATÓRIO =================
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
  } catch (e) {
    console.error('ERRO RELATORIO:', e);
  }
}

async function registrarEvento(telefone, texto) {
  const data = hoje();
  if (!relatorioDiario[data]) relatorioDiario[data] = {};
  if (!relatorioDiario[data][telefone]) relatorioDiario[data][telefone] = [];
  relatorioDiario[data][telefone].push(texto);
  await atualizarRelatorio();
}

// ================= PAINEL =================
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
  } catch (e) {
    console.error('ERRO PAINEL:', e);
  }
}

// ================= BOT =================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log('✅ Bot online');
  await atualizarPainel();
});

// ================= INTERACTIONS =================
client.on('interactionCreate', async interaction => {
  try {

    // 🔑 ACK IMEDIATO
    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) {
      if (!interaction.deferred && !interaction.replied) {
        interaction.isButton()
          ? await interaction.deferReply({ ephemeral: true })
          : await interaction.deferUpdate();
      }
    }

    const user = interaction.user;

    // ================= PAINEL =================
    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const telefone = interaction.customId.replace('entrar_', '');
      if (estadoTelefones[telefone]) return interaction.editReply('⚠️ Telefone ocupado.');

      estadoTelefones[telefone] = { userId: user.id, nome: user.username, entrada: new Date() };
      if (!atendimentosAtivos.has(user.id)) atendimentosAtivos.set(user.id, []);
      atendimentosAtivos.get(user.id).push(telefone);

      await registrarEvento(telefone, `🟢 ${hora()} — ${user.username} conectou`);
      await atualizarPainel();
      return interaction.editReply(`📞 Conectado ao telefone **${telefone}**`);
    }

    // ================= TICKET =================
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      const guild = interaction.guild;
      if (ticketsAbertos.has(user.id)) return interaction.editReply('⚠️ Você já tem um ticket aberto.');

      const canal = await guild.channels.create({
        name: `ticket-${user.username}-online`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
          { id: CARGO_STAFF_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
      });

      ticketsAbertos.set(user.id, canal.id);

      await canal.send('📞 **Ticket iniciado**\nUse os botões para gerenciar.');

      return interaction.editReply(`✅ Ticket criado: ${canal}`);
    }

  } catch (e) {
    console.error('ERRO INTERACTION:', e);
  }
});

client.login(TOKEN);

// ================= HTTP =================
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot rodando');
}).listen(PORT, () => console.log(`Servidor ouvindo na porta ${PORT}`));
