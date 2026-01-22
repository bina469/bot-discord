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
const CANAL_RELATORIO_ID = '1458342162981716039';
const CANAL_TRANSCRIPT_ID = '1463408206129664128';

const CARGO_TELEFONISTA_ID = '1463421663101059154';
const CARGO_STAFF_ID = '838753379332915280';

/* ================= CLIENT ================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

/* ================= PAINEL ================= */
const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];
const estadoTelefones = {};
const atendimentosAtivos = new Map();
const telefoneSelecionado = new Map();
let mensagemPainelId = null;

/* ================= RELATÓRIO ================= */
let mensagemRelatorioId = null;
const logsRelatorio = [];

function horarioBrasilia() {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour12: false
  });
}

async function enviarRelatorio(acao, detalhes) {
  try {
    const canal = await client.channels.fetch(CANAL_RELATORIO_ID);
    logsRelatorio.push(`[${horarioBrasilia()}] ${acao} — ${detalhes}`);

    const conteudo = `📋 **RELATÓRIO DO PAINEL**\n\n${logsRelatorio.join('\n')}`;

    if (mensagemRelatorioId) {
      try {
        const msg = await canal.messages.fetch(mensagemRelatorioId);
        return msg.edit({ content: conteudo });
      } catch {
        mensagemRelatorioId = null;
      }
    }

    const msg = await canal.send(conteudo);
    mensagemRelatorioId = msg.id;
  } catch (e) {
    console.error('Erro relatório:', e);
  }
}

/* ================= TICKETS ================= */
const ticketsAbertos = new Map();

/* ================= PAINEL RENDER ================= */
async function atualizarPainel() {
  const canal = await client.channels.fetch(CANAL_PAINEL_PRESENCA_ID);

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
      const msg = await canal.messages.fetch(mensagemPainelId);
      return msg.edit({ content: texto, components: rows });
    } catch {
      mensagemPainelId = null;
    }
  }

  const msg = await canal.send({ content: texto, components: rows });
  mensagemPainelId = msg.id;
}

/* ================= READY ================= */
client.once('ready', async () => {
  console.log('✅ Bot online');
  await atualizarPainel();

  const canalTicket = await client.channels.fetch(CANAL_ABRIR_TICKET_ID);
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

/* ================= INTERAÇÕES ================= */
client.on('interactionCreate', async interaction => {
  try {
    const replyEphemeral = async (content) => {
      await interaction.reply({ content, ephemeral: true });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    };

    /* ================= TICKET ================= */
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      if (!interaction.member.roles.cache.has(CARGO_TELEFONISTA_ID))
        return replyEphemeral('❌ Apenas telefonistas.');

      if (ticketsAbertos.has(interaction.user.id))
        return replyEphemeral('⚠️ Você já tem um ticket.');

      const canal = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}-aberto`,
        type: ChannelType.GuildText,
        parent: CATEGORIA_TICKET_ID,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
          { id: CARGO_STAFF_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
      });

      ticketsAbertos.set(interaction.user.id, canal.id);

      await canal.send({
        content: '🎫 Ticket iniciado',
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticket_fechar').setLabel('🔒 Fechar').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('ticket_excluir').setLabel('🗑️ Excluir').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('ticket_salvar').setLabel('💾 Salvar').setStyle(ButtonStyle.Primary)
          )
        ]
      });

      return replyEphemeral(`✅ Ticket criado: ${canal}`);
    }

    if (interaction.isButton() && interaction.customId === 'ticket_fechar') {
      await interaction.channel.setName(
        interaction.channel.name.replace('-aberto', '-fechado')
      );
      return interaction.update({ content: '🔒 Ticket fechado.', components: [] });
    }

    if (interaction.isButton() && interaction.customId === 'ticket_excluir') {
      ticketsAbertos.delete(interaction.user.id);
      await interaction.update({ content: '🗑️ Ticket será excluído.', components: [] });
      setTimeout(() => interaction.channel.delete(), 2000);
    }

    if (interaction.isButton() && interaction.customId === 'ticket_salvar') {
      if (!interaction.member.roles.cache.has(CARGO_STAFF_ID))
        return replyEphemeral('❌ Apenas STAFF.');

      const msgs = await interaction.channel.messages.fetch({ limit: 100 });
      const texto = msgs.reverse().map(m =>
        `[${m.createdAt.toLocaleString('pt-BR')}] ${m.author.username}: ${m.content || '(sem texto)'}`
      ).join('\n');

      const canal = await client.channels.fetch(CANAL_TRANSCRIPT_ID);
      await canal.send(`📁 **TRANSCRIPT**\n\`\`\`\n${texto}\n\`\`\``);

      return interaction.update({ content: '💾 Transcript salvo.', components: [] });
    }

  } catch (err) {
    console.error('ERRO INTERAÇÃO:', err);
  }
});

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= HTTP ================= */
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot rodando');
}).listen(PORT);
