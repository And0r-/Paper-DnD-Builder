/**
 * Word lists for generated passwords, one per language a player can choose.
 *
 * Plain everyday words: short, lowercase a-z only (no umlauts, so every
 * phone keyboard types them), nothing from any game, nothing unpleasant.
 * Size matters for strength; see password.ts. Changing a list never
 * affects existing passwords, only how new ones are made.
 */

const words = (list: string): readonly string[] => Object.freeze(list.trim().split(/\s+/));

export const WORD_LISTS: Readonly<Record<string, readonly string[]>> = {
  de: words(`
abend acker ader adler ahorn akte alarm allee alpen ameise ampel amsel angel anker anorak antenne
apfel april arena asche aster auge auster bach backe bagger bahn bahnhof balken balkon ball ballon
bambus banane band banjo bank barke bart basis bast bauch baum becher beere beet bein berg bernstein
besen beton bett beutel biber biene bild birke birne bison blase blatt blau blech blick blitz blume
bluse bock boden bohne boje boot borke bote braun brett brezel brief brille brise brombeere brot
bruder brunnen buch buche bucht buckel bude busch bussard butter chili chor clown dach dachs damm
dampf dattel datum daumen decke deich delfin delta depot diamant ding distel docht dock dohle donner
dorf dorn dose draht drossel duft dusche eber echo ecke efeu eiche eidechse eimer eingang eisen elch
elster enkel ente enzian erbse erdbeere erde ernte esel essig eule fabrik faden fahne fahrrad falke
falter farbe farn fasan fass feder feige feld fels fenster ferien ferse fest fichte filz finger fink
firma fisch flagge flasche fleck flieder flocke floh flosse flugzeug flur fluss fohlen forelle form
foto fracht frack frieden frosch frost frucht fuchs funke futter gabel galopp gans garage garn
garten gasse geige gelb geld gerste gewitter giebel gipfel gips giraffe gitarre glanz glas gleis
gletscher glocke gold golf gondel gorilla graben granit gras grau griff grill grotte grube gulasch
gummi gurke gurt hafen hafer hagel hahn haken halle halm hammer hamster hand hang hantel harfe hase
haus haut hecht hecke hefe heft heide heizung hemd henne herbst herd hering himmel hirsch hirte
hobby hobel holunder honig hose hotel huhn hummel hund hupe igel imker ingwer insel iris jacke
jaguar jahr joghurt joker jubel juli juni kabel kaffee kahn kakao kaktus kalb kamel kamera kamin
kamm kanal kaninchen kanne kante kanu kapelle kappe karotte karpfen karte karussell kasse kastanie
kater katze kauz kegel keks keller kerbe kerze kessel kette kiefer kies kino kiosk kirsche kissen
kiste kittel kiwi klavier klee kleid klinke klippe knopf knoten koala koch koffer kohl kohle kokos
kolibri komet kompass konto kopf korb kordel korn kragen krake kran kranich kraut krebs kreide kreis
krokus krone krug kuchen kuckuck kugel kumpel kupfer kurve lachs lager lama lampe land lappen larve
laub lauch lavendel leder lehm leinen leiter lenkrad leopard lerche libelle licht lied lila limette
linde lineal linie linse liste loch locke lorbeer lotse luchs luft lupe made magnet mais mandel
manege mango mantel mappe marder marke markt marmor maske mast matrose matte mauer maus medaille
meer mehl meile meise melone metall miete milch minze mispel mittag mixer mohn molch mond moos moped
morgen mosaik motor motte mulde mund muschel museum musik muskat nabel nacht nadel nagel name nase
nashorn nelke nest netz nougat nudel nuss oase oboe obst ochse ofen ohr oktober olive onkel orange
orgel otter ozean paddel paket palme panda papagei papier pappel paprika parade park pause pedal
pelikan pelz pendel perle pfanne pfeffer pfeife pferd pfirsich pflanze pflaume pfote pilz pinguin
pinie pinsel pinzette pistazie piste pizza plakat plane planet platz pokal polster pony posaune post
pracht preis primel propeller pudel puder pulli pullover pult pumpe puppe quark quelle quitte quiz
rabe radio rahmen rakete rand rasen rathaus ratte raum raupe regal regen reifen reiher reis reise
rentier rettich rezept riegel rinde ring rinne robbe rock roggen rolle roller rosa rose rosine rost
rot rubin rucksack ruder ruhe rutsche saal safari saft sahne salami salat salbei salz samen sand
sardine sattel schachtel schaf schal schale schaukel schaum schere scheune schiff schilf schinken
schirm schlitten schnecke schnee schnur schrank schraube schublade schuh schule schwamm schwan segel
segler seife seil sellerie senf sessel sieb silber silo sirup skizze socke sofa sommer sonate sonne
sorte spargel spaten spatz specht speck spiegel spiel spinat spinne spitze sport sprung stachel
stadt stall stamm stange star staub steg stein stempel stern stiefel stier stift stirn stoff stollen
storch strand strauch strom strudel stube stunde sturm sumpf suppe tabelle tafel taler tanne tante
tanz tapete tasche tasse taube taucher teich teig teleskop teller tennis teppich termin theater
thymian tiger tinte tisch toast tomate topf torte traktor traube traum treppe trommel trompete
truthahn tuba tuch tulpe tunnel turm tusche ufer uhu ulme urlaub vase vater veilchen ventil verlag
vers vitamin vogel vorhang vulkan waage wabe waffel wagen wald walnuss wand wanderer wanne wasser
watte wecker weide weiher wein weiss weizen welle welt wespe weste wetter wiege wiese wimpel wind
winter wipfel wippe wirbel wolke wolle wort wurm wurst wurzel zacke zahl zahn zander zange zaun
zebra zeder zehe zeile zeitung zelt zettel ziege ziegel ziel zimmer zimt zirkus zitrone zucchini
zucker zunge zweig zwiebel zypresse
`),
  en: words(`
acorn actor album alley almond amber anchor angle ankle anthem apple apricot apron arcade arch aspen
atlas attic autumn avocado bacon badge badger bagel baker balcony ballet balloon bamboo banana banjo
banner barley barn barrel basil basin basket bay beach beacon bead beam bean bear beaver bee beetle
bell belt bench beret berry bicycle birch bird biscuit bison blanket bloom blossom blueberry blush
board boat bobcat bonnet book boot bottle bracelet bramble branch bread breeze brick bridge brine
bronze brook broom brush bubble bucket buckle buffalo bugle bulb bunny burrow bush butter button
cabbage cabin cable cactus cafe cake camel camera camp camper canal candle candy canoe canvas canyon
caper caramel cargo carpet carrot carton cashew cat cedar celery cellar cello chair chalk cheese
cheetah cherry chess chicken chimney chord cider cinema cinnamon circle citrus clam clamp clarinet
clay cliff clock cloud clover coast cobalt cocoa coconut coffee coin collar comb comet compass cone
cookie copper coral cork corn cotton couch cousin cove coyote crab cradle crane crate crayon creek
crest cricket crocus crow crumb cube cuckoo cucumber cup curtain cushion daffodil dahlia dairy daisy
dance dandelion delta denim desert desk dew diamond diner dingo dinner dish dock dolphin domino
donkey door dough dove drawer dream drizzle drum duck dune eagle easel echo eclipse eel elbow elk
emerald engine fabric falafel falcon farm feather fence fern ferry festival fiddle field fiesta fig
finch fish fjord flag flamingo flannel fleece float flower flute foam forest fork fossil fountain
fox frog frost fruit fudge funnel gadget galaxy galley garage garden garlic garnet gate gazelle
gecko geyser gift ginger glacier glass glider globe glove gnu goat gold gondola goose gopher gorilla
grain granite grape grass gravel gravy griddle grove guava guitar gull gumbo haddock hammer hammock
hamster harbor harness harp harvest hat hatch hay hazel hazelnut heater heather hedge helium heron
hiker hill hippo hive hobby holly honey honeydew hoof hook hopscotch horse hotel house hula husky
iceberg icicle igloo ink iris island ivory ivy jackal jacket jade jaguar jam jar jasmine jelly
jellyfish jersey jigsaw jogger juice jungle kale kangaroo kayak kernel kettle keyboard kiosk kitchen
kite kitten kiwi knee koala lace ladder ladle lagoon lake lamb lamp laptop lark latch lava lavender
lawn leaf lemon lemur lentil letter lettuce level lighthouse lilac lily lime linden linen lion
lizard llama lobby lobster locket lodge loom lotus lunch lynx magnet magpie mammoth mandolin mango
mantle maple marble marigold market marsh maze meadow medal melon mesa meteor metro mink mint mirror
mitten mocha molasses mole monkey moon moose morning mosaic moss moth motor mountain mouse muffin
mug mural museum mushroom music mustard napkin narwhal nectar needle nest nickel noodle notebook
nougat nugget nutmeg oak oasis oatmeal oboe ocean octopus olive omelet onion opal orange orbit orca
orchard orchid origami ostrich otter oven owl oyster paddle pail paisley palm panda pansy panther
papaya paper parade parcel parka parrot parsley pasta pasture patio peach peacock peanut pear pebble
pelican pencil penguin peony pepper perch pewter piano pickle picnic pie pigeon pillow pine
pineapple pinwheel pistachio pita pizza planet plank plaza plum pocket polka poncho pond pony poppy
porch potato pottery pretzel prism pudding puddle puffin pulley puma pumpkin puppy quail quartz
quiche quilt rabbit raccoon racket radar radio radish raft rain rainbow raisin raspberry rattle
raven reef reindeer relay rhino rhubarb ribbon rice ridge rink river road robin rocket rodeo roof
rooster rope rose rosemary ruby rug runway saddle saffron sailboat salad salmon salsa salt sand
sandal sardine satin saucer sauna scarf school scone scooter seagull seal seed sequin sesame shell
sherbet ship shoe shovel shrimp shrub silo silver skate skillet sky slate sled slipper sloth
smoothie snail snow soap sock sofa sonnet soup sparrow spinach spinner sponge spoon spring sprout
spruce squid squirrel stable stamp star starfish stone stool stork storm straw stream street sugar
summer sun sundae sunflower sushi swan sweater syrup table taco tandem tango tapestry tea teacup
teapot tent thimble thistle thunder thyme ticket tiger timber toast toffee tomato topaz toucan towel
tower tractor train tree trellis trivia trolley trout truck trumpet tulip tuna tundra tunnel turnip
turtle tuxedo tweed ukulele umbrella urchin valley vanilla vase velvet vessel village vinyl violet
violin visor waffle wagon walkway walnut walrus warbler wardrobe wasp water wave weasel whale wheat
wheel whisk whistle willow window winter wolf wombat wool yacht yarn yodel yogurt yoyo zebra zinnia
zipper zucchini
`),
};
