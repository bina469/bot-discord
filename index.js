const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
} = require('discord.js');

const fs = require('fs');
const http = require('http');
const path = require('path');

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 10000;

const CANAL_PAINEL_PRESENCA_ID = '1458337803715739699';
const CANAL_ABRIR_TICKET_ID = '1463407852583653479';

const STATE_FILE = path.join(__dirname, 'state.json');

// ===== Carregar estado =====
let estadoTelefones = {};
let atendimentosAtivos = new Map();
try {
  if (fs.existsSync(STATE_FILE)) {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    estadoTelefones = data.estadoTelefones || {};
    atendimentosAtivos = new Map(Object.entries(data.atendimentosAtivos || {}));
  }
} catch (err) {
  console.error('Erro ao ler state.json:', err);
}

// Salvar estado
function salvarEstado() {
  const data = {
    estadoTelefones,
    atendimentosAtivos: Object.fromEntries(atendimentosAtivos)
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
}

/* ================= CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];
const telefoneSelecionado = new Map();
let mensagemPainelId = null;

/* ================= LIMPAR TELEFONES FANTASMAS ================= */
async function limparTelefonesFantasmas() {
  try {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    for (const tel of Object.keys(estadoTelefones)) {
      try {
        await guild.members.fetch(estadoTelefones[tel].userId);
      } catch {
        // Usuário não existe mais, liberar telefone
        delete estadoTelefones[tel];
      }
    }

    // Remover telefones das listas de atendimentosAtivos que não existem mais
    for (const [userId, lista] of atendimentosAtivos.entries()) {
      const novaLista = lista.filter(t => estadoTelefones[t]?.userId === userId);
      if (novaLista.length) atendimentosAtivos.set(userId, novaLista);
      else atendimentosAtivos.delete(userId);
    }

    salvarEstado();
  } catch (err) {
    console.error('Erro ao limpar telefones fantasmas:', err);
  }
}

/* ================= ATUALIZAR PAINEL ================= */
async function atualizarPainel() {
  await limparTelefonesFantasmas();

  try {
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
        .setDisabled(!!estadoTelefones[t])
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
        await msg.edit({ content: texto, components: rows });
        return;
      } catch {
        mensagemPainelId = null;
      }
    }

    const msg = await canal.send({ content: texto, components: rows });
    mensagemPainelId = msg.id;

  } catch (err) {
    console.error('ERRO AO ATUALIZAR PAINEL:', err);
  }
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
    if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isUserSelectMenu()) return;

    const userId = interaction.user.id;

    const entrarTelefone = async (tel) => {
      if (estadoTelefones[tel]) return interaction.reply({ content: '⚠️ Telefone ocupado.', ephemeral: true });

      estadoTelefones[tel] = { userId, nome: interaction.user.username };
      if (!atendimentosAtivos.has(userId)) atendimentosAtivos.set(userId, []);
      atendimentosAtivos.get(userId).push(tel);

      salvarEstado();
      await interaction.reply({ content: `📞 Conectado ao **${tel}**`, ephemeral: true });
      await atualizarPainel();
    };

    const sairTodos = async () => {
      const lista = atendimentosAtivos.get(userId) || [];
      for (const tel of lista) delete estadoTelefones[tel];
      atendimentosAtivos.delete(userId);

      salvarEstado();
      await interaction.reply({ content: '📴 Desconectado de todos', ephemeral: true });
      await atualizarPainel();
    };

    const sairUm = async (tel) => {
      if (!estadoTelefones[tel]) return interaction.update({ content: '⚠️ Telefone já estava livre.', components: [] });

      delete estadoTelefones[tel];
      atendimentosAtivos.set(userId, (atendimentosAtivos.get(userId) || []).filter(t => t !== tel));

      salvarEstado();
      await interaction.update({ content: `📴 Saiu do **${tel}**`, components: [] });
      await atualizarPainel();
    };

    const forcarTelefone = async (tel) => {
      if (!estadoTelefones[tel]) return interaction.update({ content: '⚠️ Telefone já estava livre.', components: [] });

      const antigoUserId = estadoTelefones[tel].userId;
      delete estadoTelefones[tel];
      atendimentosAtivos.set(antigoUserId, (atendimentosAtivos.get(antigoUserId) || []).filter(t => t !== tel));

      salvarEstado();
      await interaction.update({ content: `⚠️ **${tel}** desconectado à força.`, components: [] });
      await atualizarPainel();
    };

    const transferirTelefone = async (tel, novoUserId) => {
      if (!estadoTelefones[tel]) return interaction.update({ content: '❌ Transferência inválida.', components: [] });

      const antigoUserId = estadoTelefones[tel].userId;
      atendimentosAtivos.set(antigoUserId, (atendimentosAtivos.get(antigoUserId) || []).filter(t => t !== tel));

      let novoUsername = 'Usuário';
      try {
        const membro = await interaction.guild.members.fetch(novoUserId);
        novoUsername = membro.user.username;
      } catch {}

      estadoTelefones[tel] = { userId: novoUserId, nome: novoUsername };
      if (!atendimentosAtivos.has(novoUserId)) atendimentosAtivos.set(novoUserId, []);
      atendimentosAtivos.get(novoUserId).push(tel);

      salvarEstado();
      await interaction.update({ content: `🔁 **${tel}** transferido para **${novoUsername}**.`, components: [] });
      await atualizarPainel();
    };

    /* ================= BOTÕES ================= */
    if (interaction.isButton()) {
      const id = interaction.customId;
      if (id.startsWith('entrar_')) return entrarTelefone(id.replace('entrar_', ''));
      if (id === 'sair_todos') return sairTodos();

      if (id === 'menu_sair') {
        const lista = atendimentosAtivos.get(userId) || [];
        if (!lista.length) return interaction.reply({ content: '⚠️ Você não está em nenhum telefone.', ephemeral: true });

        return interaction.reply({
          content: 'Selecione o telefone para sair:',
          ephemeral: true,
          components: [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('sair_um')
                .setPlaceholder('Escolha o telefone')
                .addOptions(lista.map(t => ({ label: t, value: t })))
            )
          ]
        });
      }

      if (id === 'menu_forcar') {
        const ocupados = Object.keys(estadoTelefones);
        if (!ocupados.length) return interaction.reply({ content: '⚠️ Nenhum telefone em uso.', ephemeral: true });

        return interaction.reply({
          content: 'Selecione o telefone para forçar:',
          ephemeral: true,
          components: [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('forcar_tel')
                .setPlaceholder('Escolha o telefone')
                .addOptions(ocupados.map(t => ({ label: `${t} — ${estadoTelefones[t].nome}`, value: t })))
            )
          ]
        });
      }

      if (id === 'menu_transferir') {
        const ocupados = Object.keys(estadoTelefones);
        if (!ocupados.length) return interaction.reply({ content: '⚠️ Nenhum telefone em uso.', ephemeral: true });

        return interaction.reply({
          content: 'Selecione o telefone para transferir:',
          ephemeral: true,
          components: [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('transferir_tel')
                .setPlaceholder('Escolha o telefone')
                .addOptions(ocupados.map(t => ({ label: `${t} — ${estadoTelefones[t].nome}`, value: t })))
            )
          ]
        });
      }
    }

    /* ================= SELECT MENUS ================= */
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'sair_um') return sairUm(interaction.values[0]);
      if (interaction.customId === 'forcar_tel') return forcarTelefone(interaction.values[0]);
      if (interaction.customId === 'transferir_tel') {
        telefoneSelecionado.set(userId, interaction.values[0]);
        return interaction.update({
          content: 'Agora selecione o usuário:',
          components: [
            new ActionRowBuilder().addComponents(
              new UserSelectMenuBuilder()
                .setCustomId('transferir_user')
                .setPlaceholder('Escolha o usuário')
            )
          ]
        });
      }
    }

    if (interaction.isUserSelectMenu() && interaction.customId === 'transferir_user') {
      const tel = telefoneSelecionado.get(userId);
      telefoneSelecionado.delete(userId);
      return transferirTelefone(tel, interaction.values[0]);
    }

  } catch (err) {
    console.error('ERRO INTERACTION:', err);
  }
});

/* ================= PROTEÇÃO GLOBAL ================= */
process.on('unhandledRejection', err => console.error('UNHANDLED REJECTION:', err));
process.on('uncaughtException', err => console.error('UNCAUGHT EXCEPTION:', err));

/* ================= LOGIN ================= */
client.login(TOKEN);

/* ================= HTTP ================= */
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot rodando');
}).listen(PORT);
