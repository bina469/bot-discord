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

// Canais Painel Presença
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

// Presença
const estadoTelefones = {};
const atendimentosAtivos = new Map();
const relatorioDiario = {};
let mensagemPainelId = null;
let mensagemRelatorioId = null;

// Ticket
const ticketsAbertos = new Map();

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

/* ================= CLIENT ================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

/* ================= RELATÓRIO ================= */

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
      else {
        const novo = await canal.send(texto);
        mensagemRelatorioId = novo.id;
      }
    } else {
      const msg = await canal.send(texto);
      mensagemRelatorioId = msg.id;
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

/* ================= PAINEL PRESENÇA ================= */

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
        new ButtonBuilder()
          .setCustomId('sair_todos')
          .setLabel('🔴 Desconectar TODOS')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('menu_sair')
          .setLabel('🟠 Desconectar UM')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('menu_transferir')
          .setLabel('🔵 Transferir')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('menu_forcar')
          .setLabel('⚠️ Forçar Desconexão')
          .setStyle(ButtonStyle.Secondary)
      )
    );

    const texto = `📞 **PAINEL DE PRESENÇA**\n\n${status}\n\n👇 Use os botões abaixo`;

    if (mensagemPainelId) {
      const msg = await canal.messages.fetch(mensagemPainelId).catch(() => null);
      if (msg) await msg.edit({ content: texto, components: rows });
      else {
        const novo = await canal.send({ content: texto, components: rows });
        mensagemPainelId = novo.id;
      }
    } else {
      const msg = await canal.send({ content: texto, components: rows });
      mensagemPainelId = msg.id;
    }
  } catch (e) {
    console.error('ERRO PAINEL:', e);
  }
}

/* ================= READY ================= */

client.once('ready', async () => {
  console.log('✅ Bot online');
  await atualizarPainel();
});

/* ================= INTERACTIONS ================= */

client.on('interactionCreate', async interaction => {
  try {

    /* ===== PAINEL PRESENÇA (INTACTO) ===== */

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

      await registrarEvento(telefone, `🟢 ${hora()} — ${interaction.user.username} conectou`);
      await atualizarPainel();

      return interaction.editReply(`📞 Conectado ao telefone **${telefone}**`);
    }

    if (interaction.isButton() && interaction.customId === 'sair_todos') {
      await interaction.deferReply({ flags: 64 });

      const lista = atendimentosAtivos.get(interaction.user.id) || [];
      for (const tel of lista) {
        const dados = estadoTelefones[tel];
        await registrarEvento(tel, `🔴 ${hora()} — ${dados.nome} saiu (${tempo(dados.entrada)})`);
        delete estadoTelefones[tel];
      }
      atendimentosAtivos.delete(interaction.user.id);
      await atualizarPainel();

      return interaction.editReply('📴 Desconectado de todos os telefones.');
    }

    if (interaction.isButton() && interaction.customId === 'menu_transferir') {
      await interaction.deferReply({ flags: 64 });

      const lista = atendimentosAtivos.get(interaction.user.id) || [];
      if (!lista.length) {
        return interaction.editReply('⚠️ Você não está conectado.');
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId('transferir_tel')
        .setPlaceholder('Escolha o telefone')
        .addOptions(lista.map(t => ({ label: t, value: t })));

      return interaction.editReply({
        components: [new ActionRowBuilder().addComponents(menu)]
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'transferir_tel') {
      const telefone = interaction.values[0];

      const menuUser = new UserSelectMenuBuilder()
        .setCustomId(`transferir_user_${telefone}`)
        .setPlaceholder('Escolha o novo telefonista');

      return interaction.update({
        components: [new ActionRowBuilder().addComponents(menuUser)]
      });
    }

    if (interaction.isUserSelectMenu() && interaction.customId.startsWith('transferir_user_')) {
      const telefone = interaction.customId.replace('transferir_user_', '');
      const novoId = interaction.values[0];
      const novoUser = await client.users.fetch(novoId);
      const antigo = estadoTelefones[telefone];

      await registrarEvento(
        telefone,
        `🔁 ${hora()} — ${antigo.nome} transferiu para ${novoUser.username} (${tempo(antigo.entrada)})`
      );

      estadoTelefones[telefone] = {
        userId: novoId,
        nome: novoUser.username,
        entrada: new Date()
      };

      atendimentosAtivos.set(
        antigo.userId,
        atendimentosAtivos.get(antigo.userId).filter(t => t !== telefone)
      );

      if (!atendimentosAtivos.has(novoId)) atendimentosAtivos.set(novoId, []);
      atendimentosAtivos.get(novoId).push(telefone);

      await atualizarPainel();

      return interaction.update({
        content: `✅ Telefone **${telefone}** transferido para **${novoUser.username}**.`,
        components: []
      });
    }

    /* ===== TICKET SYSTEM ===== */

    if (interaction.isButton() && interaction.customId === 'abrir_ticket') {
      await interaction.deferReply({ flags: 64 });

      if (!interaction.member.roles.cache.has(CARGO_TELEFONISTA_ID)) {
        return interaction.editReply('❌ Apenas telefonistas.');
      }

      if (ticketsAbertos.has(interaction.user.id)) {
        return interaction.editReply('⚠️ Você já possui ticket aberto.');
      }

      const canal = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}-online`,
        type: ChannelType.GuildText,
        parent: CANAL_ABRIR_TICKET_ID,
        permissionOverwrites: [
          {
            id: interaction.guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel]
          },
          {
            id: interaction.user.id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
          },
          {
            id: CARGO_STAFF_ID,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
          }
        ]
      });

      ticketsAbertos.set(interaction.user.id, canal.id);

      await canal.send('🎫 Ticket iniciado.');

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
}).listen(PORT, () => {
  console.log(`Servidor ouvindo na porta ${PORT}`);
});
