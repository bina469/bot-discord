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

const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_RELATORIO_PRESENCA_ID = '1458342162981716039';

const CANAL_ABRIR_TICKET_ID = '1463407852583653479';
const CANAL_TRANSCRIPT_ID = '1463408206129664128';

const CARGO_TELEFONISTA_ID = '1463421663101059154';
const CARGO_STAFF_ID = '838753379332915280';

/* ================= CLIENT ================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

/* ================= PAINEL ================= */
const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];

const estadoTelefones = {};
const atendimentosAtivos = new Map();
let mensagemPainelId = null;

/* ================= TICKETS ================= */
const ticketsAbertos = new Map(); // userId -> channelId

/* ================= UTILS ================= */
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
    const msg = await canal.messages.fetch(mensagemPainelId).catch(() => null);
    if (msg) return msg.edit({ content: texto, components: rows });
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
    /* ===== PAINEL ===== */
    if (interaction.isButton() && interaction.customId.startsWith('entrar_')) {
      const tel = interaction.customId.replace('entrar_', '');
      if (estadoTelefones[tel]) {
        return interaction.reply({ content: '⚠️ Telefone ocupado.', flags: 64 });
      }

      estadoTelefones[tel] = {
        userId: interaction.user.id,
        nome: interaction.user.username,
        entrada: new Date()
      };

      if (!atendimentosAtivos.has(interaction.user.id)) {
        atendimentosAtivos.set(interaction.user.id, []);
      }
      atendimentosAtivos.get(interaction.user.id).push(tel);

      await atualizarPainel();
      return interaction.reply({ content: `📞 Conectado ao **${tel}**`, flags: 64 });
    }

    if (interaction.isButton() && interaction.customId === 'sair_todos') {
      const lista = atendimentosAtivos.get(interaction.user.id) || [];
      for (const tel of lista) delete estadoTelefones[tel];
      atendimentosAtivos.delete(interaction.user.id);
      await atualizarPainel();
      return interaction.reply({ content: '📴 Desconectado de todos', flags: 64 });
    }

    if (interaction.isButton() && interaction.customId === 'menu_sair') {
      const lista = atendimentosAtivos.get(interaction.user.id) || [];
      if (!lista.length) return interaction.reply({ content: '⚠️ Nenhum telefone.', flags: 64 });

      return interaction.reply({
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('sair_um')
              .setPlaceholder('Escolha')
              .addOptions(lista.map(t => ({ label: t, value: t })))
          )
        ],
        flags: 64
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'sair_um') {
      const tel = interaction.values[0];
      delete estadoTelefones[tel];
      atendimentosAtivos.set(
        interaction.user.id,
        atendimentosAtivos.get(interaction.user.id).filter(t => t !== tel)
      );
      await atualizarPainel();
      return interaction.update({ content: `✅ ${tel} desconectado`, components: [] });
    }

    if (interaction.isButton() && interaction.customId === 'menu_forcar') {
      const lista = Object.keys(estadoTelefones);
      if (!lista.length) return interaction.reply({ content: '⚠️ Nenhum ativo.', flags: 64 });

      return interaction.reply({
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('forcar_tel')
              .setPlaceholder('Forçar')
              .addOptions(lista.map(t => ({ label: t, value: t })))
          )
        ],
        flags: 64
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'forcar_tel') {
      const tel = interaction.values[0];
      const dados = estadoTelefones[tel];
      delete estadoTelefones[tel];
      atendimentosAtivos.set(
        dados.userId,
        atendimentosAtivos.get(dados.userId)?.filter(t => t !== tel) || []
      );
      await atualizarPainel();
      return interaction.update({ content: `⚠️ ${tel} forçado`, components: [] });
    }

    /* ===== TICKETS ===== */
    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      if (!interaction.member.roles.cache.has(CARGO_TELEFONISTA_ID)) {
        return interaction.reply({ content: '❌ Sem permissão', flags: 64 });
      }

      if (ticketsAbertos.has(interaction.user.id)) {
        return interaction.reply({ content: '⚠️ Ticket já aberto', flags: 64 });
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

      await canal.send({
        content: '🎫 Ticket aberto',
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('fechar_ticket').setLabel('🔒 Fechar').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('salvar_ticket').setLabel('💾 Salvar').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('excluir_ticket').setLabel('🗑 Excluir').setStyle(ButtonStyle.Danger)
          )
        ]
      });

      return interaction.reply({ content: '✅ Ticket criado', flags: 64 });
    }

    if (interaction.isButton() && interaction.customId === 'fechar_ticket') {
      if (!interaction.member.roles.cache.has(CARGO_STAFF_ID)) {
        await interaction.channel.edit({ name: interaction.channel.name.replace('online', 'offline') });
        return interaction.reply({ content: '🔒 Ticket fechado', flags: 64 });
      }
    }

    if (interaction.isButton() && interaction.customId === 'salvar_ticket') {
      if (!interaction.member.roles.cache.has(CARGO_STAFF_ID)) return;
      const transcript = await client.channels.fetch(CANAL_TRANSCRIPT_ID);
      await transcript.send(`📄 Ticket salvo: ${interaction.channel.name}`);
      await interaction.channel.delete();
    }

    if (interaction.isButton() && interaction.customId === 'excluir_ticket') {
      await interaction.channel.delete();
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
