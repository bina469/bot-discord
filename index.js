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
const CATEGORIA_TICKET_ID = '1463703325034676334';
const CARGO_TELEFONISTA_ID = '1463421663101059154';

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

function salvarEstado() {
  const data = {
    estadoTelefones,
    atendimentosAtivos: Object.fromEntries(atendimentosAtivos)
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
}

// ===== Client =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const telefones = ['Samantha', 'Ingrid', 'Katherine', 'Melissa', 'Rosalia'];
const telefoneSelecionado = new Map();
let mensagemPainelId = null;

// ===== Limpar telefones fantasmas =====
async function limparTelefonesFantasmas() {
  try {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    for (const tel of Object.keys(estadoTelefones)) {
      try {
        await guild.members.fetch(estadoTelefones[tel].userId);
      } catch {
        delete estadoTelefones[tel];
      }
    }

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

// ===== Atualizar painel =====
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

// ===== Função utilitária para mensagens efêmeras (auto-delete) =====
async function avisoTemporario(interaction, msg, tempoMs = 5000) {
  const resposta = await interaction.reply({ content: msg, ephemeral: true });
  setTimeout(async () => {
    try {
      const fetched = await interaction.fetchReply();
      if (fetched.deletable) await fetched.delete();
    } catch {}
  }, tempoMs);
}

// ===== READY =====
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

// ===== INTERAÇÕES =====
client.on('interactionCreate', async interaction => {
  try {
    if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isUserSelectMenu()) return;
    const userId = interaction.user.id;

    const entrarTelefone = async (tel) => {
      if (estadoTelefones[tel]) return avisoTemporario(interaction, '⚠️ Telefone ocupado.');

      estadoTelefones[tel] = { userId, nome: interaction.user.username };
      if (!atendimentosAtivos.has(userId)) atendimentosAtivos.set(userId, []);
      atendimentosAtivos.get(userId).push(tel);

      salvarEstado();
      await avisoTemporario(interaction, `📞 Conectado ao **${tel}**`);
      await atualizarPainel();
    };

    const sairTodos = async () => {
      const lista = atendimentosAtivos.get(userId) || [];
      for (const tel of lista) delete estadoTelefones[tel];
      atendimentosAtivos.delete(userId);

      salvarEstado();
      await avisoTemporario(interaction, '📴 Desconectado de todos');
      await atualizarPainel();
    };

    const sairUm = async (tel) => {
      if (!estadoTelefones[tel]) return avisoTemporario(interaction, '⚠️ Telefone já estava livre.');

      delete estadoTelefones[tel];
      atendimentosAtivos.set(userId, (atendimentosAtivos.get(userId) || []).filter(t => t !== tel));

      salvarEstado();
      await avisoTemporario(interaction, `📴 Saiu do **${tel}**`);
      await atualizarPainel();
    };

    const forcarTelefone = async (tel) => {
      if (!estadoTelefones[tel]) return avisoTemporario(interaction, '⚠️ Telefone já estava livre.');

      const antigoUserId = estadoTelefones[tel].userId;
      delete estadoTelefones[tel];
      atendimentosAtivos.set(antigoUserId, (atendimentosAtivos.get(antigoUserId) || []).filter(t => t !== tel));

      salvarEstado();
      await avisoTemporario(interaction, `⚠️ **${tel}** desconectado à força.`);
      await atualizarPainel();
    };

    const transferirTelefone = async (tel, novoUserId) => {
      if (!estadoTelefones[tel]) return avisoTemporario(interaction, '❌ Transferência inválida.');

      const antigoUserId = estadoTelefones[tel].userId;
      atendimentosAtivos.set(antigoUserId, (atendimentosAtivos.get(antigoUserId) || []).filter(t => t !== tel));

      const membro = await interaction.guild.members.fetch(novoUserId);
      if (!membro.roles.cache.has(CARGO_TELEFONISTA_ID)) {
        return avisoTemporario(interaction, '❌ Usuário não pode receber telefone.');
      }

      estadoTelefones[tel] = { userId: novoUserId, nome: membro.user.username };
      if (!atendimentosAtivos.has(novoUserId)) atendimentosAtivos.set(novoUserId, []);
      atendimentosAtivos.get(novoUserId).push(tel);

      salvarEstado();
      await avisoTemporario(interaction, `🔁 **${tel}** transferido para **${membro.user.username}**`);
      await atualizarPainel();
    };

    // ===== BOTÕES =====
    if (interaction.isButton()) {
      const id = interaction.customId;

      if (id === 'abrir_ticket') {
        const guild = interaction.guild;
        const categoria = guild.channels.cache.get(CATEGORIA_TICKET_ID);
        if (!categoria) return avisoTemporario(interaction, '❌ Categoria de ticket não encontrada.');

        await guild.channels.create({
          name: `ticket-${interaction.user.username}`,
          type: 0,
          parent: CATEGORIA_TICKET_ID,
          permissionOverwrites: [
            { id: guild.roles.everyone.id, deny: ['ViewChannel'] },
            { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages'] }
          ]
        });

        return avisoTemporario(interaction, '🎫 Ticket criado com sucesso!');
      }

      if (id.startsWith('entrar_')) return entrarTelefone(id.replace('entrar_', ''));
      if (id === 'sair_todos') return sairTodos();
      if (id === 'menu_sair') {
        const lista = atendimentosAtivos.get(userId) || [];
        if (!lista.length) return avisoTemporario(interaction, '⚠️ Você não está em nenhum telefone.');

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
        if (!ocupados.length) return avisoTemporario(interaction, '⚠️ Nenhum telefone em uso.');

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
        if (!ocupados.length) return avisoTemporario(interaction, '⚠️ Nenhum telefone em uso.');

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

    // ===== SELECT MENUS =====
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

// ===== PROTEÇÃO GLOBAL =====
process.on('unhandledRejection', err => console.error('UNHANDLED REJECTION:', err));
process.on('uncaughtException', err => console.error('UNCAUGHT EXCEPTION:', err));

// ===== LOGIN =====
client.login(TOKEN);

// ===== HTTP =====
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot rodando');
}).listen(PORT);
