import type {
  MailFixture,
  MailFixtureMessage,
  MailFixtureParticipant,
  MailFixtureThread,
} from "@plugins/apps/plugins/mail/plugins/fixtures/core";

// Demo's mailbox, as a real person's inbox looks: three weeks of mail that
// fits the rest of the demo — the Lisbon trip being planned (the flight, the
// guesthouse in Alfama, Ana's tips, which Places keeps as "Friends' tips"),
// Tokyo next (Kenji, a rail-pass newsletter), piano (the teacher, a recital,
// sheet music) and everyday mail (a concert hall, the library, receipts, a
// friend's photo, one spam, one trash, a draft reply in progress). Nothing
// about equin. Every correspondent and business is fictional, on a
// `.example` domain; every id carries `demo`. HTML bodies carry only `cid:`
// images, never a remote one. An attachment's `dataPath` is below the
// workspace demo's `data/` folder.

const DEMO: MailFixtureParticipant = {
  name: "Demo",
  address: "demo@equin.example",
};

const ANA = { name: "Ana Ribeiro", address: "ana.ribeiro@correio.example" };
const KENJI = { name: "Kenji Mori", address: "kenji.mori@post.example" };
const LEA = { name: "Léa Martin", address: "lea.martin@maison.example" };
const TOM = { name: "Tom Martin", address: "tom.martin@maison.example" };
const MUM = { name: "Mum", address: "mum@famille.example" };
const AGNES = { name: "Agnès Roux", address: "agnes.roux@voisins.example" };
const HELENE = {
  name: "Hélène Garnier",
  address: "helene@garnier-piano.example",
};

const LISBON = "Travel/Lisbon";
const TOKYO = "Travel/Tokyo";
const PIANO = "Piano";
const RECEIPTS = "Receipts";

const thread = (
  n: number,
  messages: MailFixtureMessage[],
): MailFixtureThread => ({
  id: `mthread-demo${String(n).padStart(2, "0")}`,
  messages,
});
const msgId = (n: number, part: string) =>
  `mmsg-demo${String(n).padStart(2, "0")}${part}`;

// ── HTML helpers: simple, inline-styled, no remote images ──

const FONT =
  "font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2933;line-height:1.5";

function card(opts: {
  brand: string;
  accent: string;
  body: string;
  footer: string;
}): string {
  return `<div style="background:#f4f5f7;padding:24px 0;${FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:${opts.accent};color:#ffffff;padding:16px 24px;font-size:18px;font-weight:600;letter-spacing:0.02em">${opts.brand}</td></tr>
<tr><td style="padding:24px">${opts.body}</td></tr>
<tr><td style="padding:16px 24px;background:#fafafa;color:#6b7280;font-size:12px">${opts.footer}</td></tr>
</table>
</div>`;
}

function rows(items: readonly (readonly [string, string])[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
${items
  .map(
    ([k, v]) =>
      `<tr><td style="padding:6px 0;color:#6b7280;border-bottom:1px solid #eef0f2">${k}</td><td style="padding:6px 0;text-align:right;border-bottom:1px solid #eef0f2">${v}</td></tr>`,
  )
  .join("\n")}
</table>`;
}

function receipt(opts: {
  brand: string;
  accent: string;
  intro: string;
  lines: readonly (readonly [string, string])[];
  total: string;
  footer: string;
}): string {
  return card({
    brand: opts.brand,
    accent: opts.accent,
    body: `<p style="margin:0 0 16px">${opts.intro}</p>
${rows(opts.lines)}
<p style="margin:16px 0 0;text-align:right;font-size:16px"><strong>Total ${opts.total}</strong></p>`,
    footer: opts.footer,
  });
}

// ── The flight, as the airline sends it ──

const FLIGHT_HTML = card({
  brand: "Atlantica Air",
  accent: "#0b4f6c",
  body: `<p style="margin:0 0 8px;font-size:20px;font-weight:600">You're going to Lisbon</p>
<p style="margin:0 0 20px;color:#4b5563">Booking reference <strong style="letter-spacing:0.08em">K7QZ4M</strong> · 1 passenger · Demo</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin-bottom:16px">
<tr style="background:#eef6f9"><td style="padding:10px 12px"><strong>AT 1235</strong><br>Fri 11 Dec</td><td style="padding:10px 12px">Paris Orly (ORY)<br><strong>07:40</strong></td><td style="padding:10px 12px">Lisbon (LIS)<br><strong>09:20</strong> local</td></tr>
<tr><td style="padding:10px 12px"><strong>AT 1238</strong><br>Tue 15 Dec</td><td style="padding:10px 12px">Lisbon (LIS)<br><strong>18:55</strong></td><td style="padding:10px 12px">Paris Orly (ORY)<br><strong>22:30</strong> local</td></tr>
</table>
${rows([
  ["Seat, outbound", "14C"],
  ["Seat, return", "16A"],
  ["Cabin bag", "1 × 10 kg"],
  ["Fare paid", "€148.60"],
])}
<p style="margin:20px 0 0">Online check-in opens 30 hours before departure. Gate closes 30 minutes before take-off.</p>`,
  footer:
    "Atlantica Air · bookings@atlantica-air.example · Please don't reply to this message.",
});

// ── The guesthouse in Alfama ──

const GUESTHOUSE = {
  name: "Casa do Beco",
  address: "reservas@casadobeco.example",
};

const GUESTHOUSE_HTML = card({
  brand: "Casa do Beco · Alfama",
  accent: "#b45309",
  body: `<p style="margin:0 0 16px">Olá Demo,</p>
<p style="margin:0 0 16px">Thank you for choosing Casa do Beco. Your room is booked — we look forward to welcoming you to Alfama.</p>
${rows([
  ["Confirmation", "CB-2412-118"],
  ["Arrival", "Friday 11 December, from 13:00"],
  ["Departure", "Tuesday 15 December, by 11:00"],
  ["Room", "Small double with balcony (river view)"],
  ["Guests", "2"],
  ["Breakfast", "Included, 8:00–10:30"],
  ["4 nights", "€392.00, paid on arrival"],
])}
<p style="margin:16px 0 0">Arriving early? Leave your bags with us and go for a walk — the Miradouro de Santa Luzia is two minutes up the hill.</p>`,
  footer:
    "Casa do Beco · Beco das Flores 7, Alfama, Lisbon · reservas@casadobeco.example",
});

// ── The concert hall's newsletter, its picture inline (cid:) ──

const HALL = {
  name: "Salle Garance",
  address: "newsletter@salle-garance.example",
};
const HALL_IMAGE_CID = "alfama-dusk@salle-garance.example";

const HALL_HTML = `<div style="background:#1b1b2f;padding:24px 0;${FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="padding:16px 24px;font-size:13px;letter-spacing:0.2em;text-transform:uppercase;color:#7c3aed">Salle Garance · December</td></tr>
<tr><td><img src="cid:${HALL_IMAGE_CID}" alt="Lisbon rooftops at dusk" width="560" style="display:block;width:100%;height:auto"></td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 8px;font-size:22px;font-weight:600">Saudade: an evening of fado</p>
<p style="margin:0 0 16px;color:#4b5563">Thursday 17 December · 20:00 · Grande salle</p>
<p style="margin:0 0 20px">A voice, a Portuguese guitar and a viola: the songs of Lisbon's old quarters, sung the way they are after midnight in Alfama.</p>
<p style="margin:0 0 24px"><span style="display:inline-block;background:#7c3aed;color:#ffffff;padding:10px 18px;border-radius:6px;font-weight:600">Seats from €18</span></p>
<p style="margin:0 0 8px;font-weight:600">Also this month</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
<tr><td style="padding:6px 0;border-top:1px solid #eef0f2;color:#6b7280;width:110px">Sat 5 Dec</td><td style="padding:6px 0;border-top:1px solid #eef0f2">Schubert Impromptus — solo piano recital</td></tr>
<tr><td style="padding:6px 0;border-top:1px solid #eef0f2;color:#6b7280">Sun 13 Dec</td><td style="padding:6px 0;border-top:1px solid #eef0f2">Family concert: The Nutcracker, in 45 minutes</td></tr>
<tr><td style="padding:6px 0;border-top:1px solid #eef0f2;color:#6b7280">Thu 31 Dec</td><td style="padding:6px 0;border-top:1px solid #eef0f2">New Year's Eve waltzes</td></tr>
</table>
</td></tr>
<tr><td style="padding:16px 24px;background:#fafafa;color:#6b7280;font-size:12px">You receive this because you're a Salle Garance member. Box office open Tue–Sat, 12:00–19:00.</td></tr>
</table>
</div>`;

const HALL_NOVEMBER_HTML = card({
  brand: "Salle Garance · Late November",
  accent: "#7c3aed",
  body: `<p style="margin:0 0 12px;font-size:18px;font-weight:600">Last seats this week</p>
${rows([
  ["Tue 24 Nov", "Chamber evening: Brahms piano quartets"],
  ["Thu 26 Nov", "Young pianists' showcase (free)"],
  ["Sat 28 Nov", "Film with live orchestra"],
])}
<p style="margin:16px 0 0">Members get two seats for the price of one at the showcase.</p>`,
  footer: "Salle Garance · newsletter@salle-garance.example",
});

// ── The rail-pass newsletter ──

const RAIL = {
  name: "Nihon Rail Rover",
  address: "news@rail-rover.example",
};

const RAIL_HTML = card({
  brand: "Nihon Rail Rover",
  accent: "#be123c",
  body: `<p style="margin:0 0 8px;font-size:20px;font-weight:600">Spring in Japan, by train</p>
<p style="margin:0 0 16px">Cherry blossoms reach Tokyo in late March and follow the line north through April. One pass covers the trains between them.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
<tr style="background:#fff1f2"><td style="padding:8px 12px"><strong>Pass</strong></td><td style="padding:8px 12px;text-align:right"><strong>Adult</strong></td></tr>
<tr><td style="padding:8px 12px;border-bottom:1px solid #eef0f2">7 days</td><td style="padding:8px 12px;text-align:right;border-bottom:1px solid #eef0f2">¥50,000</td></tr>
<tr><td style="padding:8px 12px;border-bottom:1px solid #eef0f2">14 days</td><td style="padding:8px 12px;text-align:right;border-bottom:1px solid #eef0f2">¥80,000</td></tr>
<tr><td style="padding:8px 12px">Tokyo area, 3 days</td><td style="padding:8px 12px;text-align:right">¥15,000</td></tr>
</table>
<p style="margin:16px 0 0"><strong>Tip:</strong> seat reservations open one month before travel — book the morning trains out of Tokyo early.</p>`,
  footer:
    "Nihon Rail Rover is an independent pass reseller · news@rail-rover.example · Unsubscribe anytime.",
});

// ── The recital invite ──

const SCHOOL = {
  name: "École de musique du Canal",
  address: "concerts@ecole-du-canal.example",
};

const RECITAL_HTML = card({
  brand: "École de musique du Canal",
  accent: "#4338ca",
  body: `<p style="margin:0 0 16px">Dear Demo,</p>
<p style="margin:0 0 16px">You're warmly invited to play in our <strong>Winter Recital</strong> — adult students, every level, one short piece each, then mulled wine.</p>
${rows([
  ["When", "Sunday 20 December, 16:00"],
  ["Where", "The small hall, 14 quai de Jemmapes"],
  ["Rehearsal", "Saturday 19 December, 14:00–16:00"],
  ["Your piece", "Mendelssohn, Song without Words Op. 85 No. 1"],
])}
<p style="margin:16px 0 0">Please confirm by 10 December. Friends and family are welcome — bring as many as you like.</p>`,
  footer: "École de musique du Canal · concerts@ecole-du-canal.example",
});

// ── The photo book ──

const PHOTO_BOOK_HTML = card({
  brand: "Atelier Lumière",
  accent: "#0f766e",
  body: `<p style="margin:0 0 12px;font-size:18px;font-weight:600">Your photo book is on its way</p>
${rows([
  ["Title", "Rome & New York"],
  ["Format", "Large landscape, 48 pages, matte"],
  ["Carrier", "Colis Rapide, tracking CR 4471 0932"],
  ["Expected", "Wednesday 25 November"],
])}
<p style="margin:16px 0 0">We hope you love it.</p>`,
  footer: "Atelier Lumière · orders@atelier-lumiere.example",
});

// ── The mailbox ──

const THREADS: MailFixtureThread[] = [
  // Today
  thread(1, [
    {
      id: msgId(1, "a"),
      ago: { minutes: 35 },
      from: HALL,
      to: [DEMO],
      subject: "December at Salle Garance: Saudade, an evening of fado",
      html: HALL_HTML,
      text: "Saudade: an evening of fado — Thursday 17 December, 20:00, Grande salle. Seats from €18.\n\nAlso this month: Schubert Impromptus (Sat 5 Dec), The Nutcracker family concert (Sun 13 Dec), New Year's Eve waltzes (Thu 31 Dec).",
      attachments: [
        {
          filename: "alfama-at-dusk.png",
          mimeType: "image/png",
          source: { dataPath: "home/Alfama at dusk.png" },
          contentId: HALL_IMAGE_CID,
        },
      ],
      unread: true,
    },
  ]),
  thread(2, [
    {
      id: msgId(2, "a"),
      ago: { hours: 1, minutes: 45 },
      from: KENJI,
      to: [DEMO],
      subject: "Tokyo in April — which week?",
      text: "Hi Demo!\n\nMy sister just asked if she can have the spare room in April, so I need to choose: are you coming the first week or the second? The first week is peak sakura but everything is packed. The second is calmer and the trees in Yanaka are usually still pink.\n\nAlso — do you want to come to my choir's concert? It's on the 11th.\n\nKenji",
      mailboxes: ["inbox", TOKYO],
      unread: true,
    },
  ]),
  thread(3, [
    {
      id: msgId(3, "a"),
      ago: { hours: 4, minutes: 10 },
      from: {
        name: "Bibliothèque du Faubourg",
        address: "reservations@bibliotheque-faubourg.example",
      },
      to: [DEMO],
      subject: "Your reservation is ready to collect",
      text: "Hello,\n\nThe item you reserved is waiting for you at the loans desk:\n\n  Lisbon on Foot — 12 walks through the old city\n\nWe'll keep it for you until Saturday 5 December.\n\nOpening hours: Tue–Fri 10:00–19:00, Sat 10:00–18:00.\n\nBibliothèque du Faubourg",
      unread: true,
    },
  ]),
  thread(4, [
    {
      id: msgId(4, "a"),
      ago: { hours: 7, minutes: 20 },
      from: LEA,
      to: [DEMO],
      subject: "Found this from our trip!",
      text: "Look what I found while clearing my phone — tram 28, the morning we got the front seats. You're going to love it all over again.\n\nSend me one from the balcony when you're there!\n\nLéa",
      attachments: [
        {
          filename: "tram 28.png",
          mimeType: "image/png",
          source: { dataPath: "home/Pictures/Trips/Lisbon/tram 28.png" },
        },
      ],
      mailboxes: ["inbox", LISBON],
      unread: true,
    },
  ]),

  // Yesterday
  thread(5, [
    {
      id: msgId(5, "a"),
      ago: { hours: 20 },
      from: AGNES,
      to: [DEMO],
      subject: "Plants while you're in Lisbon?",
      text: "Hello neighbour!\n\nTom mentioned you're away the week of the 11th. I'm happy to water your plants again — just leave the key in my letterbox like last time. How often does the big fig need it?\n\nAgnès (3rd floor)",
    },
    {
      id: msgId(5, "b"),
      ago: { hours: 18, minutes: 30 },
      from: DEMO,
      to: [AGNES],
      subject: "Re: Plants while you're in Lisbon?",
      text: "Agnès, you're a star — thank you!\n\nThe fig wants a big glass of water twice a week, the others once. I'll leave the key on Thursday evening, and",
      mailboxes: ["drafts"],
      draft: true,
    },
  ]),
  thread(6, [
    {
      id: msgId(6, "a"),
      ago: { days: 1, hours: 2 },
      from: {
        name: "Prize Department",
        address: "winner@lucky-draw.example",
      },
      to: [DEMO],
      subject: "CONGRATULATIONS!!! You have been selected (ref 99-2041)",
      text: "Dear valued customer,\n\nYour email address was selected in our annual draw. To claim your prize of €850,000 please reply with your full name, bank details and a processing fee of €49.\n\nAct now, this offer expires in 24 hours!",
      mailboxes: ["spam"],
      unread: true,
    },
  ]),
  thread(7, [
    {
      id: msgId(7, "a"),
      ago: { days: 1, hours: 9 },
      from: HELENE,
      to: [DEMO],
      subject: "Can we move Thursday's lesson?",
      text: "Hello Demo,\n\nI've been asked to accompany a student's exam next Thursday afternoon, so I can't do our 18:00. Could we move to Saturday 5th instead? I have 10:30 or 15:00.\n\nBest,\nHélène",
      mailboxes: ["inbox", PIANO],
    },
    {
      id: msgId(7, "b"),
      ago: { days: 1, hours: 6 },
      from: DEMO,
      to: [HELENE],
      subject: "Re: Can we move Thursday's lesson?",
      text: "Hello Hélène,\n\nNo problem at all — Saturday 10:30 is perfect. It gives me two more days with the Mendelssohn, which I need!\n\nSee you then,\nDemo",
      mailboxes: ["sent", PIANO],
    },
    {
      id: msgId(7, "c"),
      ago: { days: 1, hours: 5 },
      from: HELENE,
      to: [DEMO],
      subject: "Re: Can we move Thursday's lesson?",
      text: "Perfect, Saturday 10:30 then. Bring the Mendelssohn and we'll work on the left hand under the melody — slowly!\n\nHélène",
      mailboxes: ["inbox", PIANO],
    },
  ]),
  thread(8, [
    {
      id: msgId(8, "a"),
      ago: { days: 1, hours: 20 },
      from: { name: "Canal Runners", address: "hello@canal-runners.example" },
      to: [DEMO],
      subject: "Sunday run: canal loop, 8:30 at Jaurès",
      text: "Morning all,\n\nThis Sunday we're doing the canal loop: up to La Villette and back, 8 km, easy pace. Meet at 8:30 by the Jaurès steps. Croissants after at the usual place.\n\nIf it rains we run anyway.\n\n— Marc, for Canal Runners",
    },
  ]),

  // This week
  thread(9, [
    {
      id: msgId(9, "a"),
      ago: { days: 2, hours: 3 },
      from: RAIL,
      to: [DEMO],
      subject: "Spring in Japan, by train — passes and blossom dates",
      html: RAIL_HTML,
      mailboxes: ["inbox", TOKYO],
      unread: true,
    },
  ]),
  thread(10, [
    {
      id: msgId(10, "a"),
      ago: { days: 2, hours: 6 },
      from: MUM,
      to: [DEMO],
      subject: "Christmas",
      text: "Darling,\n\nAre you coming down on the 23rd or the 24th? Your brother is driving from Lyon on the 23rd and could pick you up at the station.\n\nAnd will you play something for us this year? Grandpa still talks about last Christmas.\n\nLots of love,\nMum",
    },
    {
      id: msgId(10, "b"),
      ago: { days: 2, hours: 1 },
      from: DEMO,
      to: [MUM],
      subject: "Re: Christmas",
      text: "Hi Mum,\n\nThe 23rd — I'll take the 15:12 train, so tell him around 17:30.\n\nAnd yes, I'll play. I'm learning a Mendelssohn piece for a recital on the 20th, so you'll get the rehearsed version.\n\nLove,\nDemo",
      mailboxes: ["sent"],
    },
  ]),
  thread(11, [
    {
      id: msgId(11, "a"),
      ago: { days: 3, hours: 1 },
      from: SCHOOL,
      to: [DEMO],
      subject: "Invitation: Winter Recital, Sunday 20 December",
      html: RECITAL_HTML,
      mailboxes: ["inbox", PIANO],
      starred: true,
    },
  ]),
  thread(12, [
    {
      id: msgId(12, "a"),
      ago: { days: 3, hours: 4 },
      from: { name: "Vélo Vert", address: "receipts@velo-vert.example" },
      to: [DEMO],
      subject: "Your November receipt",
      html: receipt({
        brand: "Vélo Vert",
        accent: "#15803d",
        intro: "Thanks for riding with us in November.",
        lines: [
          ["Monthly pass", "€8.90"],
          ["Extra time, 3 rides", "€2.00"],
          ["Rides this month", "23 · 61 km"],
        ],
        total: "€10.90",
        footer: "Vélo Vert bike share · receipts@velo-vert.example",
      }),
      mailboxes: ["inbox", RECEIPTS],
    },
  ]),
  thread(13, [
    {
      id: msgId(13, "a"),
      ago: { days: 4, hours: 2 },
      from: LEA,
      to: [DEMO],
      cc: [TOM],
      subject: "Dinner at ours Saturday?",
      text: "Hey! Tom is making his famous lasagne on Saturday — come around 20:00? Bring nothing. Well, maybe bring dessert.\n\nL.",
    },
    {
      id: msgId(13, "b"),
      ago: { days: 4 },
      from: DEMO,
      to: [LEA],
      cc: [TOM],
      subject: "Re: Dinner at ours Saturday?",
      text: "Yes please! I'll bring a tarte tatin. Is the digicode still the same?\n\nDemo",
      mailboxes: ["sent"],
    },
    {
      id: msgId(13, "c"),
      ago: { days: 3, hours: 20 },
      from: TOM,
      to: [DEMO],
      cc: [LEA],
      subject: "Re: Dinner at ours Saturday?",
      text: "Still 4B12, third floor left. Tarte tatin accepted with enthusiasm.\n\nTom",
    },
  ]),
  thread(14, [
    {
      id: msgId(14, "a"),
      ago: { days: 8 },
      from: GUESTHOUSE,
      to: [DEMO],
      subject: "Booking confirmed: Casa do Beco, 11–15 December",
      html: GUESTHOUSE_HTML,
      mailboxes: ["inbox", LISBON],
    },
    {
      id: msgId(14, "b"),
      ago: { days: 7, hours: 2 },
      from: DEMO,
      to: [GUESTHOUSE],
      subject: "Re: Booking confirmed: Casa do Beco, 11–15 December",
      text: "Olá, and thank you!\n\nOne question: could you recommend a small fado evening near you on the Saturday, and reserve two seats if it's possible? A friend told me about a place with no sign, but I can't find it on any map.\n\nObrigado,\nDemo",
      mailboxes: ["sent", LISBON],
    },
    {
      id: msgId(14, "c"),
      ago: { days: 4, hours: 5 },
      from: GUESTHOUSE,
      to: [DEMO],
      subject: "Re: Booking confirmed: Casa do Beco, 11–15 December",
      text: "Olá Demo,\n\nYour friend has good taste — that must be Tasca da Lua, upstairs in Bairro Alto, and it has never had a sign. We reserved two seats for Saturday at 21:30 (doors at 21:00, table 6). The ticket is attached: show it on your phone at the door.\n\nAté breve,\nMariana, Casa do Beco",
      attachments: [
        {
          filename: "Fado night ticket.pdf",
          mimeType: "application/pdf",
          source: { dataPath: "home/Fado night ticket.pdf" },
        },
      ],
      mailboxes: ["inbox", LISBON],
      starred: true,
    },
  ]),
  thread(15, [
    {
      id: msgId(15, "a"),
      ago: { days: 5, hours: 3 },
      from: {
        name: "Cabinet dentaire Voltaire",
        address: "rdv@dentaire-voltaire.example",
      },
      to: [DEMO],
      subject: "Reminder: appointment on Tuesday 8 December, 9:15",
      text: "Hello,\n\nThis is a reminder of your check-up with Dr. Lefort on Tuesday 8 December at 9:15.\n\nTo move or cancel, reply to this message at least 48 hours ahead.\n\nCabinet dentaire Voltaire",
    },
  ]),

  // Last week
  thread(16, [
    {
      id: msgId(16, "a"),
      ago: { days: 6, hours: 4 },
      from: DEMO,
      to: [ANA],
      subject: "We're coming 11–15 Dec! Your tips?",
      text: "Ana!\n\nIt's booked: we land on Friday the 11th and fly back Tuesday evening. We're staying in Alfama this time.\n\nYou know Lisbon better than anyone — where should we eat, drink and listen to fado? And when can we see you?\n\nDemo",
      mailboxes: ["sent", LISBON],
    },
    {
      id: msgId(16, "b"),
      ago: { days: 5, hours: 20 },
      from: ANA,
      to: [DEMO],
      subject: "Re: We're coming 11–15 Dec! Your tips?",
      text: "YES. Finally!\n\nMy list, in order of importance:\n\n1. Fado: the small place in Bairro Alto with no sign. Go after 10 pm, when the neighbours start singing.\n2. Drinks: the bar on top of the car park on Calçada do Combro — take the lift to the top floor and keep going.\n3. Dinner: Taberna do Largo, near the cathedral. No reservations, go at 19:00 or wait an hour. Order whatever fish the owner points at.\n4. Pastries: the bakery at the bottom of my street opens at 7. The custard tarts come out warm at 8.\n5. Tram 28: board at Martim Moniz, the first stop, or you'll stand the whole way.\n6. Sunset: the steps by the river at Ribeira das Naus, with a beer from the kiosk.\n\nI'm free Saturday lunch and Monday evening. Sunday I'm at my parents' in Sintra — come along if you go!\n\nBeijinhos,\nAna",
      mailboxes: ["inbox", LISBON],
      starred: true,
    },
    {
      id: msgId(16, "c"),
      ago: { days: 5, hours: 10 },
      from: DEMO,
      to: [ANA],
      subject: "Re: We're coming 11–15 Dec! Your tips?",
      text: "This is perfect — every single one is saved on my map now, under \"Friends' tips\".\n\nSaturday lunch it is, and yes to Sintra on Sunday if your parents don't mind. We'll bring something from Paris.\n\nDemo",
      mailboxes: ["sent", LISBON],
    },
  ]),
  thread(17, [
    {
      id: msgId(17, "a"),
      ago: { days: 6, hours: 9 },
      from: {
        name: "Banque du Faubourg",
        address: "no-reply@banque-faubourg.example",
      },
      to: [DEMO],
      subject: "Your November statement is available",
      text: "Hello,\n\nYour statement for current account ending 4417 is available in your online space.\n\nFor your security, we will never ask for your password by email.\n\nBanque du Faubourg",
      mailboxes: [],
    },
  ]),
  thread(18, [
    {
      id: msgId(18, "a"),
      ago: { days: 7, hours: 6 },
      from: {
        name: "Atelier Lumière",
        address: "orders@atelier-lumiere.example",
      },
      to: [DEMO],
      subject: 'Shipped: your photo book "Rome & New York"',
      html: PHOTO_BOOK_HTML,
      mailboxes: ["Travel"],
    },
  ]),
  thread(19, [
    {
      id: msgId(19, "a"),
      ago: { days: 9 },
      from: {
        name: "Atlantica Air",
        address: "bookings@atlantica-air.example",
      },
      to: [DEMO],
      subject: "Your booking K7QZ4M: Paris – Lisbon, 11 December",
      html: FLIGHT_HTML,
      text: "Booking reference K7QZ4M\n\nAT 1235 · Fri 11 Dec · Paris Orly 07:40 → Lisbon 09:20\nAT 1238 · Tue 15 Dec · Lisbon 18:55 → Paris Orly 22:30\n\nSeats 14C / 16A · 1 cabin bag · €148.60",
      mailboxes: ["inbox", LISBON],
    },
  ]),
  thread(20, [
    {
      id: msgId(20, "a"),
      ago: { days: 9, hours: 5 },
      from: {
        name: "Cinéma du Canal",
        address: "billets@cinema-du-canal.example",
      },
      to: [DEMO],
      subject: "Your tickets: Thursday 19 November, 20:45",
      html: receipt({
        brand: "Cinéma du Canal",
        accent: "#991b1b",
        intro: "Show this email at the door. Screen 2, seats F7–F8.",
        lines: [
          ["Full price × 1", "€11.50"],
          ["Member price × 1", "€8.00"],
        ],
        total: "€19.50",
        footer: "Cinéma du Canal · billets@cinema-du-canal.example",
      }),
      mailboxes: [RECEIPTS],
    },
  ]),
  thread(21, [
    {
      id: msgId(21, "a"),
      ago: { days: 10, hours: 2 },
      from: {
        name: "Partition & Co",
        address: "commandes@partition-co.example",
      },
      to: [DEMO],
      subject: "Order PC-58213 confirmed",
      html: receipt({
        brand: "Partition & Co · sheet music",
        accent: "#6d28d9",
        intro: "Thank you for your order — it ships tomorrow.",
        lines: [
          ["Mendelssohn, Songs without Words (urtext)", "€24.50"],
          ["Pencil and eraser set", "€3.20"],
          ["Shipping", "€4.90"],
        ],
        total: "€32.60",
        footer: "Partition & Co · commandes@partition-co.example",
      }),
      mailboxes: ["inbox", RECEIPTS, PIANO],
    },
  ]),
  thread(22, [
    {
      id: msgId(22, "a"),
      ago: { days: 11, hours: 4 },
      from: {
        name: "Syndic Saint-Maur",
        address: "gestion@syndic-saint-maur.example",
      },
      to: [DEMO],
      subject: "Water cut on Tuesday morning",
      text: "Dear residents,\n\nThe water will be cut on Tuesday from 8:00 to 12:00 while the riser in staircase B is replaced. We apologise for the inconvenience.\n\nThe building management",
      mailboxes: [],
    },
  ]),
  thread(23, [
    {
      id: msgId(23, "a"),
      ago: { days: 12, hours: 3 },
      from: {
        name: "Marché Oberkampf",
        address: "commandes@marche-oberkampf.example",
      },
      to: [DEMO],
      subject: "Delivered: your groceries",
      html: receipt({
        brand: "Marché Oberkampf",
        accent: "#ca8a04",
        intro: "Delivered Sunday at 10:42. Enjoy!",
        lines: [
          ["Eggs, free range × 6", "€3.40"],
          ["Tomatoes, 1 kg", "€3.90"],
          ["Feta", "€4.20"],
          ["Sourdough loaf", "€4.80"],
          ["Delivery", "€2.99"],
        ],
        total: "€19.29",
        footer: "Marché Oberkampf · commandes@marche-oberkampf.example",
      }),
      mailboxes: [RECEIPTS],
    },
  ]),
  thread(24, [
    {
      id: msgId(24, "a"),
      ago: { days: 13, hours: 6 },
      from: DEMO,
      to: [KENJI],
      subject: "Spring?",
      text: "Kenji!\n\nLisbon is booked for December, and I keep thinking Tokyo should be next. Would April work for you? I'd love to see Yanaka again and finally hear your choir.\n\nDemo",
      mailboxes: ["sent", TOKYO],
    },
    {
      id: msgId(24, "b"),
      ago: { days: 12, hours: 18 },
      from: KENJI,
      to: [DEMO],
      subject: "Re: Spring?",
      text: "April is perfect!! The spare room is yours. Get a rail pass if you want to go out to the mountains — I'll take you to the onsen town I told you about.\n\nKenji",
      mailboxes: [TOKYO],
    },
  ]),

  // Two and three weeks ago
  thread(25, [
    {
      id: msgId(25, "a"),
      ago: { days: 14, hours: 2 },
      from: {
        name: "Bibliothèque du Faubourg",
        address: "prets@bibliotheque-faubourg.example",
      },
      to: [DEMO],
      subject: "Your loans are due in 3 days",
      text: "Hello,\n\nThe following loans are due back on Monday 16 November:\n\n  - Piano Technique for Grown-ups\n  - The Art of the Japanese Bath\n\nYou can renew them once online.\n\nBibliothèque du Faubourg",
      mailboxes: [],
    },
  ]),
  thread(26, [
    {
      id: msgId(26, "a"),
      ago: { days: 15, hours: 1 },
      from: {
        name: "Maison Plume",
        address: "offres@maison-plume.example",
      },
      to: [DEMO],
      subject: "Last chance: 40% off throw cushions",
      text: "Our cushion sale ends tonight at midnight. 40% off every throw cushion, while stocks last.",
      mailboxes: ["trash"],
    },
  ]),
  thread(27, [
    {
      id: msgId(27, "a"),
      ago: { days: 16, hours: 3 },
      from: {
        name: "Accord Parfait",
        address: "rdv@accord-parfait.example",
      },
      to: [DEMO],
      subject: "Piano tuning confirmed: Monday 16 November, 14:00",
      text: "Hello,\n\nYour tuning is confirmed for Monday 16 November at 14:00, Rue Saint-Maur. Our tuner, Julien, will need about an hour and a quiet room.\n\nAccord Parfait",
      mailboxes: [PIANO],
    },
  ]),
  thread(28, [
    {
      id: msgId(28, "a"),
      ago: { days: 17, hours: 5 },
      from: HALL,
      to: [DEMO],
      subject: "Last seats this week at Salle Garance",
      html: HALL_NOVEMBER_HTML,
    },
  ]),
  thread(29, [
    {
      id: msgId(29, "a"),
      ago: { days: 19, hours: 8 },
      from: ANA,
      to: [DEMO],
      subject: "Are you finally coming in December?",
      text: "You promised! The city is lovely in December — no crowds, the lights are up and it's still 15°.\n\nTell me the dates and I'll keep them free.\n\nAna",
      mailboxes: [LISBON],
    },
    {
      id: msgId(29, "b"),
      ago: { days: 19, hours: 2 },
      from: DEMO,
      to: [ANA],
      subject: "Re: Are you finally coming in December?",
      text: "I am! Looking at the week of the 11th — I'll book the flights this week and tell you.\n\nDemo",
      mailboxes: ["sent", LISBON],
    },
  ]),
  thread(30, [
    {
      id: msgId(30, "a"),
      ago: { days: 20, hours: 4 },
      from: {
        name: "Atlantica Air",
        address: "offers@atlantica-air.example",
      },
      to: [DEMO],
      subject: "Winter sun from €39: Lisbon, Porto, Madeira",
      text: "Escape the grey: one-way fares from Paris Orly to Lisbon from €39, Porto from €45 and Madeira from €69. Book by 15 November for travel until 28 February.",
      mailboxes: ["Travel"],
    },
  ]),
];

export const DEMO_MAIL: MailFixture = {
  account: {
    address: DEMO.address,
    displayName: "Demo",
    signature: "Demo\nParis",
  },
  // Colours from the providers' label palette (Gmail's pairs, the ones Mail offers).
  labels: [
    { path: "Travel", color: "#4a86e8" },
    { path: LISBON, color: "#ffad47" },
    { path: TOKYO, color: "#f691b3" },
    { path: PIANO, color: "#a479e2" },
    { path: RECEIPTS, color: "#16a766" },
  ],
  threads: THREADS,
};
