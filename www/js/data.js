// Trip data for Scotland with a 4-year-old, 18–24 Aug 2026
// Edinburgh (festival season) + day trips to Stirling and Glasgow

const TRIP = {
  title: "Scotland with Ally",
  subtitle: "Edinburgh · Stirling · Glasgow — 19–24 Aug 2026",
  dates: "Wed 19 Aug (PM arrival) – Mon 24 Aug 2026 (AM departure to Portsmouth)",
  nights: 5,
  traveler: "Family of 3, child age 4 (walks — no stroller)",
};

const CITY_COLORS = {
  Edinburgh: "#2f5d8c",
  Stirling: "#7a5c3e",
  Glasgow: "#8c3f6b",
  Travel: "#4a7a5f",
};

const DAYS = [
  {
    date: "Wed 19 Aug",
    day: "Day 1",
    city: "Edinburgh",
    title: "Afternoon arrival — Botanic Garden or Museum",
    summary:
      "Landing mid/late afternoon leaves a few hours, not a full day — pick ONE low-key thing based on weather and how tired everyone is, then dinner and an early night. Don't try to fit both.",
    items: [
      {
        time: "PM",
        name: "Option A: Royal Botanic Garden Edinburgh",
        place: "Royal Botanic Garden",
        detail:
          "Free entry (donation welcome). 70+ acres of lawns and paths — good if the weather's decent and everyone wants to run off travel energy outdoors. Glasshouses closed for restoration through 2026.",
        tag: "Free",
      },
      {
        time: "PM",
        name: "Option B: National Museum of Scotland",
        place: "National Museum of Scotland",
        detail:
          "Free entry. Indoor and low-key — a better call if it's wet or everyone's just tired after travel. Under-5s Imagine gallery, T-Rex, café on site. Open till 17:00.",
        tag: "Free",
      },
      {
        time: "Eve",
        name: "Dinner",
        detail: "Scran & Scallie or Bell's Diner (Stockbridge, near the Botanics) if you did Option A, or Civerinos on Hunter Square (near the Museum) if you did Option B.",
        tag: "Food",
      },
    ],
  },
  {
    date: "Thu 20 Aug",
    day: "Day 2",
    city: "Edinburgh",
    title: "Fringe morning + Old Town",
    summary:
      "Weekday morning — Old Town is calmest before lunch. Book a kids' show, picnic in George Square Gardens, home for an early afternoon rest.",
    items: [
      {
        time: "12:00",
        name: "The Amazing Bubble Man",
        detail:
          "Underbelly George Square (Udderbelly tent). Daily 12:00 noon through 31 Aug. From ~£10.50 incl. fees. Age 0+. Book ahead — it sells out.",
        tag: "Fringe · Book ahead",
      },
      {
        time: "Midday",
        name: "Picnic, George Square Gardens",
        detail: "Food stalls and picnic tables around the Assembly/Underbelly hub.",
        tag: "Food",
      },
      {
        time: "PM",
        name: "Optional: Splash Test Dummies Circus",
        detail:
          "Circus Hub on the Meadows, ~12:05pm. Runs Thu–Sun only, so today's one of the few days it fits. From ~£15.50 — only add this if the Bubble Man show didn't already tire everyone out.",
        tag: "Fringe · Optional",
      },
      {
        time: "PM",
        name: "Rest at accommodation",
        detail: "Front-load the day — a 4-year-old flags in festival crowds by mid-afternoon.",
        tag: "Downtime",
      },
    ],
  },
  {
    date: "Fri 21 Aug",
    day: "Day 3",
    city: "Stirling",
    title: "Day trip: Stirling Castle",
    summary:
      "Driving — ~36 miles/50 min each way via the M9, no tolls. Cheaper than the train for this trip (~£13–19 fuel+parking vs ~£24 for two adult train fares) and means no 0.5-mile uphill walk from the station to the Castle. Stirling is quiet compared to Edinburgh — good rebalance before the festival's busiest weekend.",
    items: [
      {
        time: "09:00",
        name: "Drive: Edinburgh → Stirling",
        detail: "~36 miles via the M9, ~50 min with no tolls. Fuel cost roughly £9–15 for the round trip depending on your car's mpg.",
        tag: "Drive",
      },
      {
        time: "10:00",
        name: "Stirling Castle",
        place: "Stirling Castle",
        detail:
          "Great Hall, Royal Palace, kitchens. Adult from £17.50 online, under-7s free, family (2+2) ~£53 online. Open 9:30–18:00 (Apr–Sep). Less crowded than Edinburgh Castle — easier with a walking 4-year-old. Castle car park: £4 flat, up to 4 hours — can fill up on busy days, so arrive close to opening.",
        tag: "£53 family",
      },
      {
        time: "PM",
        name: "National Wallace Monument (view from outside, optional climb)",
        place: "National Wallace Monument",
        detail:
          "The tower itself is a 246-step spiral staircase — tough for a 4-year-old, so treat the climb as optional/for one adult. The grounds and view up at the monument are worth the stop regardless. Adult ~£16.50, family ~£44. Has its own car park.",
        tag: "Optional climb",
      },
      {
        time: "Eve",
        name: "Drive back to Edinburgh",
        detail: "Same ~50 min drive. Aim to leave before evening rush on the M9/A720.",
        tag: "Drive",
      },
    ],
  },
  {
    date: "Sat 22 Aug",
    day: "Day 4",
    city: "Glasgow",
    title: "Day trip: Glasgow museums",
    summary:
      "Driving — ~46 miles/1h each way via the M8, no tolls. Cost is close to a wash against the train (~£23–32 fuel+parking vs ~£26–34 for two adult train fares), but the real win is Kelvingrove and the Science Centre are ~3 miles apart and NOT walkable — with the car it's a direct 10-min drive between them instead of a bus/subway/taxi transfer. Saturday traffic on the M8 should be lighter than a weekday commute.",
    items: [
      {
        time: "09:00",
        name: "Drive: Edinburgh → Glasgow",
        detail: "~46 miles via the M8, ~1h with no tolls. Fuel cost roughly £12–19 for the round trip depending on your car's mpg.",
        tag: "Drive",
      },
      {
        time: "10:00",
        name: "Kelvingrove Art Gallery & Museum",
        place: "Kelvingrove Art Gallery & Museum",
        detail:
          "Free entry to the permanent collection — Scotland's most-visited free attraction. Sir Roger the stuffed elephant, floating heads, arms & armour, natural history. Open Mon–Thu & Sat 10–5, Fri & Sun 11–5. On-site car park off Argyle Street, ~100 spaces, £3/hour.",
        tag: "Free",
      },
      {
        time: "~13:00",
        name: "Drive: Kelvingrove → Glasgow Science Centre",
        detail: "~10 min via the Squinty Bridge/M8 — this leg isn't walkable, so having the car directly solves the gap between the two attractions.",
        tag: "Drive",
      },
      {
        time: "13:30",
        name: "Glasgow Science Centre",
        place: "Glasgow Science Centre",
        detail:
          "Interactive hands-on exhibits, planetarium (+£3.50). Adult ~£15.50 off-peak, child ~£12, family (2+2) ~£35. Open Wed–Sun in term time, daily in school holidays. Its own car park is £4 flat for the day if you're visiting the Centre.",
        tag: "~£35 family",
      },
      {
        time: "Eve",
        name: "Drive back to Edinburgh",
        detail: "Grab dinner in Glasgow first if energy allows (Paesano Pizza is a few minutes from the M8), or eat once back. ~1h drive.",
        tag: "Drive",
      },
    ],
  },
  {
    date: "Sun 23 Aug",
    day: "Day 5",
    city: "Edinburgh",
    title: "Zoo or beach — stay out of the Old Town",
    summary:
      "Peak festival crush weekend continues. Pick one: Edinburgh Zoo (book ahead) or Portobello Beach — both out of the congested centre.",
    items: [
      {
        time: "10:00",
        name: "Edinburgh Zoo",
        place: "Edinburgh Zoo",
        detail:
          "Adult £29.50, child (3–15) £17.50, under-3 free; family ~£48. Hillside site, fine for a walking 4-year-old with good shoes. Note: Penguin Parade is postponed indefinitely (avian flu precaution) — don't promise penguins on parade.",
        tag: "~£48 family",
      },
      {
        time: "alt",
        name: "Alternative: Portobello Beach",
        place: "Portobello Beach",
        detail:
          "Free. Sand, shallow paddling, promenade for scooters, two playgrounds, ice cream. Bus 15/26, ~20–25 min.",
        tag: "Free",
      },
    ],
  },
  {
    date: "Mon 24 Aug",
    day: "Day 6",
    city: "Edinburgh",
    title: "Departure to Portsmouth",
    summary:
      "Morning departure — there's no real time for an activity today. Pack the night before so the morning is just breakfast and leaving, not a scramble with a 4-year-old.",
    items: [
      {
        time: "AM",
        name: "Travel to Portsmouth",
        detail: "Pad in extra time to get to the airport/station — festival-season traffic and taxis get busy even early. Have snacks ready for the journey.",
        tag: "Travel",
      },
    ],
  },
];

const PLACES = [
  {
    city: "Edinburgh",
    name: "National Museum of Scotland",
    category: "Museum",
    price: "Free",
    notes: "Under-5s Imagine gallery, T-Rex, interactive Science floor. Best rainy-day pick.",
    website: "https://www.nms.ac.uk/national-museum-of-scotland/",
    mapsQuery: "National Museum of Scotland Chambers Street Edinburgh",
  },
  {
    city: "Edinburgh",
    name: "Royal Botanic Garden",
    category: "Park",
    price: "Free (donation)",
    notes: "70+ acres, calm escape from festival crowds. Glasshouses closed through 2026.",
    website: "https://www.rbge.org.uk/",
    mapsQuery: "Royal Botanic Garden Edinburgh Inverleith Row",
  },
  {
    city: "Edinburgh",
    name: "Edinburgh Zoo",
    category: "Zoo",
    price: "~£48 family",
    notes: "Book online ahead. Penguin Parade postponed indefinitely.",
    website: "https://www.edinburghzoo.org.uk/",
    mapsQuery: "Edinburgh Zoo Corstorphine Road",
  },
  {
    city: "Edinburgh",
    name: "Camera Obscura & World of Illusions",
    category: "Attraction",
    price: "~£25 adult",
    notes: "Early-bird discount before 9am. All-weather, lots of stairs.",
    website: "https://www.camera-obscura.co.uk/",
    mapsQuery: "Camera Obscura Castlehill Edinburgh",
  },
  {
    city: "Edinburgh",
    name: "Edinburgh Castle",
    category: "Castle",
    price: "~£21.50 adult",
    notes: "Steep cobbles — go at 09:30 opening on a weekday to beat crowds.",
    website: "https://www.edinburghcastle.scot/",
    mapsQuery: "Edinburgh Castle Castlehill Edinburgh",
  },
  {
    city: "Edinburgh",
    name: "Portobello Beach",
    category: "Beach",
    price: "Free",
    notes: "Sand, paddling, playgrounds, ice cream. Bus 15/26.",
    website: "https://www.edinburgh.gov.uk/directory-record/1085967/portobello-parks-and-beach",
    mapsQuery: "Portobello Beach Edinburgh",
  },
  {
    city: "Edinburgh",
    name: "Cramond",
    category: "Beach",
    price: "Free",
    notes: "Tidal causeway to Cramond Island — check safe-crossing times before walking out.",
    website: "https://www.cramondassociation.org.uk/visiting-cramond",
    mapsQuery: "Cramond Edinburgh",
  },
  {
    city: "Stirling",
    name: "Stirling Castle",
    category: "Castle",
    price: "~£53 family",
    notes: "Great Hall, Royal Palace. Quieter than Edinburgh Castle. ~50 min drive from Edinburgh via the M9; on-site car park £4 flat (up to 4 hrs).",
    website: "https://www.stirlingcastle.scot/",
    mapsQuery: "Stirling Castle Stirling",
  },
  {
    city: "Stirling",
    name: "National Wallace Monument",
    category: "Monument",
    price: "~£44 family",
    notes: "246-step spiral stair to the top — treat as optional with a 4-year-old.",
    website: "https://www.nationalwallacemonument.com/",
    mapsQuery: "National Wallace Monument Abbey Craig Stirling",
  },
  {
    city: "Glasgow",
    name: "Kelvingrove Art Gallery & Museum",
    category: "Museum",
    price: "Free",
    notes: "Scotland's most-visited free attraction. Great for kids — animals, arms & armour.",
    website: "https://www.glasgowlife.org.uk/museums/venues/kelvingrove-art-gallery-and-museum",
    mapsQuery: "Kelvingrove Art Gallery and Museum Glasgow",
  },
  {
    city: "Glasgow",
    name: "Glasgow Science Centre",
    category: "Science Centre",
    price: "~£35 family",
    notes: "Hands-on interactive exhibits, planetarium extra. Check open days (closed Mon/Tue in term time).",
    website: "https://www.glasgowsciencecentre.org/",
    mapsQuery: "Glasgow Science Centre 50 Pacific Quay",
  },
];

// Lunch/dinner picks: independent, well-reviewed on Google, mid-range (not fast-food
// chains, not fine-dining prices), and genuinely easy with a young child.
const EATS = [
  {
    city: "Edinburgh",
    area: "Stockbridge / New Town",
    name: "The Pantry",
    meal: "Lunch / Brunch",
    price: "££",
    nearAttraction: "Royal Botanic Garden",
    distance: "~15 min walk (East Gate)",
    notes: "Locally sourced brunch & lunch with a colourful kids' menu. Open 9am–3pm only — a lunch spot, not a dinner one.",
    website: "https://www.thepantryedinburgh.co.uk/",
    mapsQuery: "The Pantry 1 NW Circus Place Edinburgh",
  },
  {
    city: "Edinburgh",
    area: "Stockbridge / New Town",
    name: "Scran & Scallie",
    meal: "Dinner",
    price: "£££",
    nearAttraction: "Royal Botanic Garden",
    distance: "~15 min walk (East Gate)",
    notes: "Gastropub from Michelin-starred chefs Tom Kitchin & Dominic Jack, but a proper kids' menu and a soundproofed play corner keep it genuinely family-friendly — good food without fine-dining prices or pressure.",
    website: "https://scranandscallie.com/",
    mapsQuery: "Scran and Scallie Comely Bank Road Edinburgh",
  },
  {
    city: "Edinburgh",
    area: "Old Town — near the Fringe hub",
    name: "Civerinos (Teviot Place)",
    meal: "Lunch",
    price: "£",
    nearAttraction: "George Square Gardens (Fringe shows)",
    distance: "~5 min walk, right by Bristo Square",
    notes: "Casual sit-down pizza genuinely a few minutes from Underbelly/Assembly at George Square Gardens. Quick, cheap, no reservation needed — good fit straight after a morning kids' show.",
    website: "https://www.civerinos.com/",
    mapsQuery: "Civerinos Teviot Place Edinburgh",
  },
  {
    city: "Edinburgh",
    area: "Old Town — near the Museum",
    name: "Civerinos (Hunter Square)",
    meal: "Lunch",
    price: "£",
    nearAttraction: "National Museum of Scotland",
    distance: "~3 min walk from Chambers Street",
    notes: "Same casual pizza spot, different branch — this one's the closest sit-down lunch to the Museum, on the Royal Mile side.",
    website: "https://www.civerinos.com/locations/hunters-square/",
    mapsQuery: "Civerinos Hunter Square Edinburgh",
  },
  {
    city: "Edinburgh",
    area: "Portobello",
    name: "The Beach House",
    meal: "Lunch",
    price: "£",
    nearAttraction: "Portobello Beach",
    distance: "Right on the promenade",
    notes: "Relaxed seaside cafe right on the promenade with beach views — easy with sandy kids in tow.",
    website: "https://www.thebeachhousecafe.co.uk/",
    mapsQuery: "The Beach House Cafe 57 Bath Street Portobello Edinburgh",
  },
  {
    city: "Edinburgh",
    area: "Portobello",
    name: "Miro's on the Prom",
    meal: "Dinner",
    price: "££",
    nearAttraction: "Portobello Beach",
    distance: "Right on the promenade",
    notes: "A genuine local family favourite for dinner on the promenade, not just a tourist stop.",
    website: "https://www.mirosportobello.co.uk/",
    mapsQuery: "Miros on the Prom Portobello Edinburgh",
  },
  {
    city: "Stirling",
    area: "City centre",
    name: "Fletcher's",
    meal: "Lunch / Dinner",
    price: "££",
    nearAttraction: "Stirling Castle",
    distance: "~10 min walk uphill (Upper Craigs)",
    notes: "Stirling's Restaurant of the Year (2023 & 2025) — steaks, pizza and pasta alongside a dedicated kids' menu. Free parking.",
    website: "https://fletchersstirling.co.uk/",
    mapsQuery: "Fletcher's Restaurant 78 Upper Craigs Stirling",
  },
  {
    city: "Stirling",
    area: "Near the train station",
    name: "Gabe's Diner",
    meal: "Casual alternative",
    price: "£",
    nearAttraction: "Stirling train station",
    distance: "~5 min walk (Forthside Way)",
    notes: "Small, warm, independent bistro. It's on the opposite side of town from the Castle esplanade (~20 min walk there) — better thought of as a quick bite before/after your train than a Castle-day lunch.",
    website: "https://www.gabesdiner.co.uk/",
    mapsQuery: "Gabe's Diner Forthside Way Stirling",
  },
  {
    city: "Glasgow",
    area: "Kelvingrove",
    name: "An Clachan Cafe",
    meal: "Lunch",
    price: "£",
    nearAttraction: "Kelvingrove Art Gallery & Museum",
    distance: "~2 min walk, inside Kelvingrove Park",
    notes: "Sits right inside the park by the museum, mostly Fairtrade/organic, relaxed — an easy stop straight after the gallery.",
    website: "https://kelvingroveparkcafe.co.uk/",
    mapsQuery: "An Clachan Cafe Kelvingrove Park Glasgow",
  },
  {
    city: "Glasgow",
    area: "Merchant City / city centre",
    name: "Paesano Pizza",
    meal: "Dinner",
    price: "£",
    nearAttraction: "Queen Street / Central Station",
    distance: "~5–10 min walk from either station",
    notes: "Note: this is NOT near Glasgow Science Centre (Pacific Quay is ~3 miles away, a bus/subway/taxi ride, not walkable) — it's positioned for dinner in the city centre right before you catch the train back to Edinburgh. Wood-fired Neapolitan pizza, casual, well-reviewed, no fine-dining prices.",
    website: "https://www.paesanopizza.co.uk/glasgow-citycentre",
    mapsQuery: "Paesano Pizza 94 Miller Street Glasgow",
  },
];

const BUDGET = [
  { item: "1–2 paid Fringe kids' shows", low: 45, high: 90 },
  { item: "Free/PWYC show donations", low: 5, high: 15 },
  { item: "Stirling Castle (family)", low: 41, high: 53 },
  { item: "Wallace Monument (optional)", low: 0, high: 44 },
  { item: "Glasgow Science Centre (family)", low: 0, high: 35 },
  { item: "Edinburgh Zoo (family)", low: 0, high: 48 },
  { item: "National Museum of Scotland", low: 0, high: 0 },
  { item: "Royal Botanic Garden / Kelvingrove / beaches", low: 0, high: 0 },
  { item: "Fuel: Edinburgh↔Stirling↔Glasgow driving (return, ~164 miles)", low: 21, high: 34 },
  { item: "Parking: Stirling Castle + Glasgow (Kelvingrove + Science Centre)", low: 14, high: 16 },
  { item: "Local buses/trams in Edinburgh", low: 20, high: 40 },
  { item: "Treats, ice cream, café stops", low: 40, high: 60 },
];

const PACKING = [
  "Comfortable walking shoes for everyone — no stroller, so your 4-year-old is on their own feet all week",
  "Light backpack for your child to carry their own water bottle/snack (helps pacing and gives them ownership)",
  "Waterproof jacket + layers (expect ~16 rainy days in August, highs ~19°C, lows ~11°C)",
  "Small umbrella or packable rain poncho",
  "Snacks for train journeys and queueing",
  "Portable phone charger (photos, tickets, maps all day)",
  "Printed or downloaded tickets for Fringe shows, Castle, Zoo (patchy signal in crowds)",
  "A comfort item/toy for train legs and downtime",
];

const TIPS = [
  {
    title: "Walking pace, not stroller pace",
    body:
      "Your child walks the whole week — no buggy to fold on trains or push over cobbles. That's actually easier logistically, but budget more rest stops than an adult itinerary would: aim for one seated break every 60–90 minutes, and keep any single 'big attraction' under 2 hours before food or downtime.",
  },
  {
    title: "One main activity a day",
    body:
      "Don't stack a Fringe show AND a big attraction AND a long walk on the same day. This itinerary deliberately gives each day one anchor activity.",
  },
  {
    title: "Short trip: no spare days",
    body:
      "A PM arrival Wednesday and an AM departure Monday leaves 4 full days plus one half-day — every day in this plan is already spoken for, with nothing held in reserve. If one day gets rained out or the flight's delayed, the honest trade-off is dropping the least essential piece that day (the optional Wallace Monument climb, Splash Test Dummies, or the whole Zoo/Beach day) rather than trying to double up elsewhere.",
  },
  {
    title: "Weekend crowd-dodge",
    body:
      "22–23 Aug is the Fringe's peak crush in Edinburgh's Old Town. This plan routes you to Glasgow on the Saturday and keeps Sunday to the Zoo/beach — both away from the centre.",
  },
  {
    title: "Cramond tide safety",
    body:
      "If you visit Cramond, the causeway to Cramond Island is only safe ~2 hours either side of low tide. Check the safe-crossing board or text CRAMOND to 81400 before crossing.",
  },
  {
    title: "Book ahead",
    body:
      "Fringe kids' shows, Edinburgh Zoo, and Stirling Castle can sell out on sunny weekends — book online a few days before.",
  },
  {
    title: "Driving to Stirling & Glasgow",
    body:
      "You already have the car, so driving beats the train on cost for Stirling (~£13–19 all-in vs ~£24 for two adult train fares) and is roughly a wash for Glasgow — but it directly solves the fact that Kelvingrove and the Science Centre are ~3 miles apart and not walkable. No motorway tolls in Scotland either way. Stirling Castle's car park can fill up on busy days, so aim for opening time; in Glasgow, park at Kelvingrove first, then a 10-min drive to the Science Centre's own car park for the afternoon.",
  },
];
