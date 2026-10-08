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
  fr: words(`
abeille abricot acier affiche agenda agneau aigle aiguille ail aimant alouette alpaga amande ambre
ampoule ananas ancre aneth angora anguille anis anneau anorak antenne aquarium arbre arbuste arche
ardoise argent argile armoire arrosoir artichaut artiste asperge assiette aster atelier atlas aube
aubergine aurore autobus automne autruche avenue avion avocat avoine avril azur bagage bague
baguette baie baignoire balade balai balcon baleine balise ballade balle ballon bambou banane banc
bandeau banjo banque banquette baobab barbe barbecue barque barrage barreau basilic bassin bassine
bateau bateleur bazar bec beignet belette berceau berge berger besace betterave beurre bibelot
biberon biche bijou biscotte biscuit bison blaireau blanc bleu bleuet bloc blouse blouson bobine
bocage bocal bois boisson bol bonbon bonnet bord bordure bosquet botte bouc bouchon boucle bouclette
bougeoir bougie bouillon boulanger boule bouleau boulevard bouquet bourdon bourgeon bourse boussole
bouteille boutique bouton bouvreuil bracelet branche brasero bretelle bretzel brindille brioche
brise brocante broche brochet brosse brouette brugnon bruine brume brun buffet buisson bulle bureau
bus buvard cabane cabas cabine cacao cachette cachou cactus cadeau cadenas cadet cadran cadre cageot
cahier cahute caille caillou caisse calebasse calendrier calepin calmar camion camomille campagne
campanule canal canard canari canne canot cantine canyon capuche capucine carafe caramel carillon
carnet carotte carpe carreau carrosse carrousel cartable carton cascade casier casque casquette
casserole cassis castor caverne ceinture cerceau cerf cerise cerisier chaise chaland chalet chambre
chameau champ chandail chanson chant chapeau chapelle charbon chardon chariot charme chat chaton
chaussette chausson chaussure chemin chemise cheval chevalet cheveu chevreuil chien chiffon chiffre
chignon chiot chocolat chou chouette ciboulette ciel cigale cigogne cinq cintre cirque citron
citronnade citrouille clafoutis clairon clapier classeur clavier cloche clocher clou cobaye
coccinelle cochon cocon cocotier coffre coffret coing colibri colin colis collant collier colline
colombe compas compote comptoir concert concombre confetti confiture copain coq coquelicot
coquillage coquille corail corbeau corbeille corde cordon cornet cornichon costume coton coude
couette couleur couloir coupe coupelle coupole courge courgette couronne courrier coussin couvercle
crabe craie crapaud cravate crayon cresson crevette criquet cristal crochet crocus croissant
croquette cuir cuisine cuivre cuvette cyclamen cygne dahlia dalle dattier dauphin delta dentelle
dentifrice dessin diamant dimanche dinette disque doigt dossier douche drap drapeau dune duvet
enclos encre encrier enveloppe escabeau escalier escargot espadon fagot faisan falaise fanfare
fanion farandole farine fauteuil fenouil fermier feuillage feuille feutre feutrine ficelle figue
figuier fil filet flacon flamant flan fleur fleuve flocon foin fondue fontaine four fourmi fourneau
fraise fraisier framboise frigo friture fromage fruit fumet furet fusain galet galette gant garage
gare gaufre gazelle gazon geai gecko gilet gingembre girafe girofle glace glacier globe glycine
gobelet golfe gomme gondole gorille gouache gourmet goutte goyave graine grange granit grappe grelot
grenier grenouille grillon griotte groseille grotte guirlande guitare gymnase halte hamac hamster
hangar haricot harmonica harpe herbe hibou hiver homard horloge hortensia houx hublot huile humus
igloo igname indigo iris ivoire jacinthe jade jambon janvier jardin jarre jasmin jaune jeudi jonc
jonquille jouet journal juillet juin jument jungle jupe jus kangourou kayak kermesse kiosque kiwi
koala lac lacet lagon lagune laine lait laitue lama lampe lampion languette lanterne lapin lard
lardon lasagne laurier lavabo lavande layette lecture lentille lessive lettre lierre lilas limande
limonade lin linge linotte lion liseron lit litchi livre locomotive loir loquet losange lotus louche
loup loupe loutre luciole lundi lune lunettes luth lynx macaron madeleine magasin magnolia mai
maillot main mainate maison malle manche mandarine mangue manteau maquette marbre marche mardi
margelle marguerite marina marmite marmotte marraine marron mars marteau mascotte massif matelas
matelot matin mazout melon menthe menton merlan merle mesure meuble meunier miel miette mimosa minou
mirabelle miroir mistral mitaine mocassin moineau moka mollet montagne montre moquette morille morse
mouchoir mouette moufle moulin moulinet mousse mousson moustache mouton muguet mur muret muscade
museau musique myrtille nappe narcisse navet navire nectar neige nid noisetier noisette noix nougat
noyau nuage nuit oasis ocelot octobre oeuf oie oignon oiseau olive olivier ombre omelette opale
opossum orage orange orchestre oreiller orge orgue orignal orque osier otarie ouate ourlet oursin
ourson outil ouvrage pagaie paillasson paille pain palette palmier panache panais panda panier
panneau panorama pantalon pantin pantoufle paon papaye papeterie papier papillon paquet parapluie
parasol paravent parc parfum parquet passerelle passoire pastel pastille patate patin patio pavot
peigne peinture pelle pelote pelouse pendentif pendule perche perdrix perle perroquet persienne
persil peuplier phare phoque photo piano pichet pieuvre pigeon pignon pilote piment pinceau pingouin
pinson pioche pipette pirogue piscine pistache pistil placard plafond plage plaid plaine planche
plante platane plateau plume plumeau poche poire poireau poirier pois poisson poivre poivrier
poivron polder pollen pomme pommier pompier pompon poney pont port portail porte poste potage
potager poterie potiron pouce poudre poulain poule poulet poulpe poupe poussin prairie pralin
praline prune puits pull puma pupitre pyjama quai quartz quiche quinoa raclette radar radeau radio
radis rainette raisin rameau rampe rangement raquette rayon recette remorque renard renne renoncule
requin rhubarbe rideau rigole risotto rivage rivet robe robinet rocher romarin ronce rondelle
roquette rose roseau rossignol rotin roue rouge rouleau roulotte ruban ruche ruelle ruisseau sable
sablier sabot sac sacoche safari safran salade salamandre salon salopette samedi sandale santon
sapin sardine sarrasin satellite satin sauce saucisse saule saumon sauterelle savane savon
savonnette seau seigle sel semaine semoule sentier septembre serre serviette sifflet silo singe
sirop soie soir soleil sorbet soucoupe soupape sourire souris spatule statue stylo sucre sucrier
sureau tableau tablette tablier tabouret tamarin tambour tamis tandem tapioca tapis tarte tartelette
tartine tasse taupe taureau teckel teinture tente terrasse terre terrier thermos thon thym tigre
tilleul timbre tipi tiroir tisane tissu toboggan toile toit tomate tonneau tonnerre torchon tortue
toucan toupie tourelle tournesol tourte tracteur train tram trampoline tramway treillis tremplin
tribune tricot trompette tronc trottoir trousse truffe truite tuile tulipe tunique tunnel turquoise
tuyau vache vague valise vallon vanille vanneau vapeur vase vasque veau velours vendredi vent verger
vernis verre verveine veste viaduc vigne vignette village vinaigre violet violette violon vitrail
vitrine voile voilette voilier voiture volcan volet wagon wapiti yaourt yourte zeppelin zinc
`),
  it: words(`
abete abito accendino acciuga acero aceto acqua acquario acrobata aereo affetto affresco agenda
aglio agnello ago agosto airone aiuola alba albergo albero albicocca albume alce alga alloro alpaca
altalena alveare amaca amarena ambra amico ananas anatra ancora anello anemone anfora angolo
anguilla anguria anice antenna antilope antipasto ape aprile aquila aquilone arachide arancia
arancio aratro arco arcobaleno argento argilla aringa armadio armonica arnia aroma arpa ascensore
asilo asino asparago astro astronave astuccio atlante atomo autista autobus autunno avena avocado
avorio azalea bacchetta badile baffi bagno baita balcone balena baleno balsamo bambagia bambino
bambola bambu banana banco banda bandiera barattolo barba barca barchetta barile basco basilico
bastone battello batuffolo baule bavaglino bavarese bazar becco benzina bergamotto berlina berretto
betulla biberon bicchiere bidone bietola biglietto bigodino bilancia binario bisaccia biscia
biscotto bisonte bistecca boccale bombetta bombolone bonsai borgo borotalco borraccia borsa borsetta
bosco bosso botte bottega bottiglia bottone bozzolo bracciale braccio bracciolo brace brezza bricco
brina brioche brocca broccolo brodo bruco bucaneve bucato budino bufalo burro bussola busta cabina
cacao cachi cactus caffe calabrone calamaio calamaro calce calcio caldaia calendario calice calza
camicia caminetto camino camion cammello camoscio campana campanile campo canale canapa canarino
candela candito cane canestro canguro canna cannella cannuccia canoa canottiera cantina canzone
capanna capitello cappello cappotto capra capriolo caraffa caramella caramello carbone carciofo
cardellino carillon carlino carota carovana carrello carretto carro carta cartella cartolina cartone
casa cascata casco cassetta cassetto castagna castagno castello castoro catena cavallo cavatappi
caviglia cavolfiore cavolo cedro cefalo cemento cena cenere centro cerbiatto cerchio cereale
cerniera cerotto cervo cespuglio cesta cestino chiave chiocciola chiodo chiosco chitarra ciabatta
ciambella cicala ciclamino cicogna cielo ciglio cigno ciliegia cima cinghia cintura cioccolato
ciotola ciottolo cipolla cipresso circo citta ciuffo civetta clessidra coccinella cocco cocomero
coda colibri colla collana collare collina colomba colonna colore coltello cometa comodino compasso
conca conchiglia coniglio coperchio coperta copertina corallo corda coriandolo cornetto cornice
corniola cortile cortina corvo cosmo costa cotoletta cotone cozza cratere cravatta crema cremino
criceto crisantemo cristallo crostata cucchiaio cucina cuculo cuffia cugino cuoco cupcake cupola
cuscino dalia dattero delfino dente deserto diamante diario dirupo ditale divanetto divano dolce
dolcetto domenica domino donnola dromedario duna edera elefante elica emporio erba erbario erica
estate etichetta faggio fagiano fagiolo fagotto falco falegname falena fanale farfalla farfallina
farina faro fattoria fazzoletto febbraio felce fermacarte ferramenta ferretto ferro ferrovia festa
fetta fiaccola fiamma fiammifero fico fienile fieno filo filobus fiocco fiordaliso fiordo fiore
fischietto fiume flauto foca focaccia focolare fodera foglia fontana fontanella forbici forchetta
foresta formaggio formica fornaio fornello forno fotografia fragola frangia frassino fratello frigo
frittata frittella fronte frontiera frullato frutta fucsia fumo fungo fuoco furgone gabbia gabbiano
galassia galleria gallina gallo gamba gamberetto gambero garage garofano gattino gatto gattopardo
gazebo gazza gelateria gelato gelso gelsomino gemma geranio gerla gesso gettone ghiacciolo ghianda
ghiro giacca gianduia giardino giglio ginepro ginocchio giocattolo giornale giostra giraffa
girandola girasole girello girino giugno goccia gomito gomitolo gomma gondola gonna gorilla gradino
granaio granchio granita grano grappolo grattugia grembiule grillo grissino grotta gru guanto
guardaroba gufo guscio iceberg igloo imbuto incenso inchiostro insalata isola lago lamella lampada
lampadario lampione lampone lana lanterna lapis latte lattina lattuga lavagna lavagnetta lavanda
lavatrice lavello leggio legno lenticchia lentiggine lenzuolo lepre lettera lettino letto libellula
libreria libro lievito lima limonata limone lince lino liquirizia lombrico lucchetto lucciola luce
lucertola lumaca lumino luna lupino macchina madia magazzino maglia maglione magnolia maiale mais
mandarino mandolino mandorla mangiatoia mango manico maniglia mantello mantide mappa marea
margherita marmellata marmo marmotta marsupio martello maschera materasso matita mattino mattone
mattonella medaglia medusa mela melanzana melodia melograno melone menta mercato merenda meridiana
merlo merluzzo mestiere mestolo mezzaluna mezzanotte micio miele miglio mimosa minestra minestrone
minuto mirtillo mobile molla mollica molo moneta montagna montone mora mosaico mozzarella mucca
muffin mughetto mulino muro muschio museo narciso naso nastro nave nebbia negozio nespola nespolo
nido nocciola nocciolo noce nodo noleggio nonna nonno nota notte nuvola nuvoletta oblo oca ocarina
oceano officina oleandro olio oliva ombelico ombra ombrellino ombrello ombrellone onda orata
orchestra orchidea orecchino origano ormeggio orologiaio orologio orsa orsetto orso ortica orto
ostello ostrica ottobre ovile pacco padella paese pagina paglia pagnotta palazzo paletta palla
palloncino palma palo palude panca panchina panda pane panetteria panettone panfilo panino panna
pantofola papavero paperella paperino pappagallo paracadute parasole parco parmigiano passeggino
passero pasta pastello pastore patata patio pattino pavone pecora pecorino pellicano penisola penna
pennello pentola pepe peperone pepita pera pergola perla persiana pesca pesce pesciolino pesco
petalo pettine pettirosso piano pianoforte pianta piastrella piattino piatto piazza picchio piccione
pigiama pigna pinguino pino pinolo pioggia pioppo piscina pistacchio pitone piuma pizza pizzico
platano polenta pollaio pollice polline pollo polpetta polpo poltrona pomeriggio pomodoro pompelmo
ponte popcorn porcino porta porticato porto portone postino pozzo prato prezzemolo prua prugna
pulcino puma pupazzo puzzle quaderno quadro quaglia quercia racchetta radicchio radice raggio ragno
rametto ramo rana ranocchio rapa rastrello ravanello razzo regalo regata renna rete ribes riccio
ricotta rifugio righello ringhiera riso ristorante riva robot roccia rombo rondine rosa rosmarino
rotolo rotonda rubinetto rubino rucola ruota ruscello sabbia sacco salame salice salmone salotto
salsiccia saltello salvagente salvia sambuco sandalo sapone sardella sardina sasso sassofono sbarra
scacchiera scaffale scala scaletta scarabeo scarpa scarpone scatola scatoletta scatolone schiuma
scialle sciarpa sciatore scimmia scintilla scivolo scodella scogliera scoglio scoiattolo scopa
scrivania secchio sedano sedia sedile segnale sella semaforo seme semola sentiero seppia serra
settembre sfoglia sgabello siepe slitta smeraldo soffitta solaio sole sonaglio sorbetto sorella
sorgente sottobosco spago spatola spazzola spazzolino specchio spiaggia spiga spillo spinaci sponda
sportello spremuta spugna squalo stagione stagno stambecco stanza stazione stella stelo stemma
stendino stivale stoffa stoppino stoviglia strada strudel struzzo stufa succo sughero sugo susina
sveglia tacchino taccuino tagliere talpa tamarindo tamburello tamburo tapiro tappeto tappo tartaruga
tartufo tasca tavoletta tavolo tazza tazzina teatro tegame tegola teiera telaio telefono tenda
termos terrazza terrazzo terriccio tetto tigre timbro timo timone tinta tisana tonno topazio topo
topolino tornio torre torrone torta tortellino tortino tortora tovaglia traghetto tramonto
trampolino trapezio trattore trenino treno triciclo trifoglio triglia tromba tropico trota trottola
tubo tucano tulipano tunnel turchese uliveto uncinetto uncino uovo uva valigia valle vaniglia varano
vasca vaso vassoio vela veliero ventaglio vento ventola veranda verdura vespa vetrina vetro viale
vigna vigneto villa vimini viola violino vitamina vitello vitigno vivaio volano volpe vongola
vulcano zafferano zaino zampa zampogna zanzara zanzariera zappa zattera zebra zecchino zenzero
zoccolo zolla zoo zucca zucchero zuppa
`),
  es: words(`
abanico abeja abeto abrigo abuela abuelo aceite aceituna acelga acera acuario adorno aeropuerto
agenda agua aguacate aguacero aguja ajo ala alambre albahaca albergue alcachofa aldea alerce alfiler
alfombra alga almeja almendra almez almohada alondra alpaca altavoz alubia amanecer amapola amarillo
amigo anchoa ancla andamio anguila anillo antena anteojos apartado apio apunte arado arbusto arcilla
ardilla arena arenque arete armario aro arpa arrecife arroyo arroz asador asiento astilla atlas aula
aurora ave avellana avellano avena avestruz azotea azucena azul azulejo babero bacalao badajo
balanza balde ballena balsa banana bananero banco banda bandeja bandera barandilla barba barbilla
barca barco barniz barquillo barril barro base bata batido batidora baya bebida bellota berberecho
berenjena berro biblioteca bicicleta bigote billete bisagra bisonte bizcocho blusa boca bocadillo
bocina bolero bolsa bolsillo bombero bombilla bombo bordado borrador borrego bosque bota botella
botijo boya brazo brezo brisa brocha brote bruma bucle buey bufanda burbuja butaca caballo cabeza
cable cabra cacahuete cacao cacerola cachorro cactus cadena cafetera cafeto caimito caja cajita
calabaza calamar caldero caldo calendario calle calor calzado cama camarote camelia camello
caminante camino camisa campana campo canal canario canasta candado canela cangrejo canoa canto capa
capota capullo caqui cara carabela caracol caramelo carey carpa carpeta carreta carrito carro
carrusel cartel cartera casa cascada casco caseta casita castillo castor caverna cazo cebada cebolla
cebollino cebra cedro ceja celeste cena ceniza centeno cepillo cerca cereal cereza cerezo cerilla
cerradura cesta cesto chal chaleco chapa chaqueta charco charol chicle chimenea chinchilla chirimoya
chocolate chopo chorizo choza chupete ciclamen cielo cierva ciervo cifra cigarra cima cine cinta
cinto circo ciruela cisne ciudad clarinete clavel clavo clima cobertor cobre coche cocina coco
cocodrilo codo codorniz cogollo cohete col coleta coliflor colina collar colmena color columpio
comedor cometa comida conejo conserva copa copete copo coral corbata corcho cordel cordero corneta
coro corral corteza cortijo cortina cosecha costa crema cremallera criba cristal cuaderno cuadra
cuadro cubeta cubo cuchara cuello cuenco cuerda cuervo cueva cumbia cumbre cuna dalia dedal dedo
desayuno desierto diadema dibujo diente dintel disco docena ducha dulce durazno edificio ejote
elefante elote embudo empanada encaje enchufe encina engranaje enredadera ensaimada ensalada envase
erizo escalera escarcha escoba escuadra escuela esmeralda espejo espiga espinaca esponja espuma
esquina establo estanque estatua estrado estrella estuche estufa fajo falda farmacia faro farol
farola farolillo fauna felpudo fideo fieltro fiesta flamenco flan flauta flor flora florero florista
fogata folio frambuesa frasco fresa fresal fresno frijol frontera fruta fuego fuente fular funda
gacela gafas galera galleta gallina gallo ganso garaje garbanzo garrafa garza gato gaveta gaviota
gazpacho gemelo geranio gimnasio girasol gladiolo globo gofre golondrina goma gorila gorra gorro
gota granada granero granito granizo granja grano grapa grava grifo grillo grosella grulla guacamayo
guante guarda guayaba guijarro guinda guirnalda guisante guiso guitarra hamaca hangar harina hebilla
helado helecho heno hiedra hielo hierba higo hilera hilo hinojo hoguera hoja hojaldre hombro
horizonte hormiga hornillo horno hortensia hostal hotel hucha huella huerta huerto hueso humedal
humo iguana impresora insecto invierno isla jacinto jaguar jarabe jarra jaula jengibre jersey
jilguero jinete jirafa jojoba joya jugo juguete jungla kayak kimono kiwi koala labio lacito ladera
ladrillo lagar lagartija lagarto lago laguna lana lancha langosta lapa lapicero lata laurel lavanda
lazo leche lechuga lechuza legumbre lengua lente lenteja lentejuela leopardo letra libreta libro
licuadora liebre lienzo lila lima limonada lince lino linterna lirio litera llama llanura llave
llavero lluvia lobo loma lomo lona loro lucero lucio luna lupa maceta madera madreselva magdalena
magnolia majuelo maleta malva mampara manantial mandarina mandil manga mango manguera manivela mano
manta mantel manzana manzanilla mapa mapache maqueta mar maraca marco marea marfil margarita
mariposa marisco marmita marquesina mascota mazorca medalla mejilla mejorana membrillo menta mercado
merienda merluza mermelada mesa mesilla metro miel mimbre mimosa mirador mirlo mochila mochuelo
molde molino molusco moneda mono monte montura mora morsa mortero mosaico mostaza mosto mostrador
moto mueble muelle muralla museo musgo naranja naranjo narciso nariz nata nave neblina nectarina
nevada nevera nido niebla nieve nogal noria nube nuez nutria oasis obra oca ocarina ocaso oficina
ola oliva olivar olivo olla olmo ombligo onda oreja orilla oro oruga oso ostra oveja ovillo paella
pajarita pala palacio palangana palco palillo palmera palo paloma pampa pan panadero panal panda
panecillo pantano pantufla papagayo papel papelera paraguas parcela parque parra pasaje pasamanos
pasillo pasta pastel pastizal pastor patata patilla patio pato pavo payaso peca pecera peine pelo
pelota peluche pelusa penacho pepino pera percebe percha perdiz perejil perla perro pescado petunia
pez piano picaporte pie piedra pijama pimentero pimienta pimiento pimpollo pinar pincel pino pinza
pipa piragua piscina pista pistacho pizarra pizza plancha planeta planta platillo plato playa plaza
plomo pluma plumero polea polen poleo pollo pomada pomelo poncho porche portal postal postre potro
pozo pradera prado primavera puchero pueblo puente puerta puerto pulpo pulsera puma pupitre
quesadilla quesera queso quinoa quiosco radio rama rambla ramo rana ranura rastrillo rayo rebanada
rebeca recado receta red redil regadera regalo regla reloj remo remolacha retama retrato revista
riachuelo ribera riel rizo roble roca rodaballo rodaja rodilla rodillo romero ropa rosa rosal
rosquilla rueca rueda rulo sabana sabanilla sacapuntas saco sal salamandra salero salmonete salsa
salvia sandalia sapo sardina sarmiento sauce sauna secador sedal sello selva semilla semillero senda
sendero sepia serpentina servilleta seta sierra silbato silla silo sobre sol sombra sombrero
sombrilla sonaja sonrisa sopa sorbete suelo surco taburete tacita taco tambor tamboril tapa tapete
tapiz tarima tarro tarta taza teatro techo teclado teja tejado tejo tela telar telescopio tenedor
terraza tetera tienda tierra tigre tijera tilo timbre tinaja tintero tiza toalla tobillo toldo
tomate tomillo tormenta tornillo torre torrente torta tortilla tortuga tostada totora tractor trapo
tren trigal trigo trineo trompa trompeta trompo tronco trucha tuerca turquesa ukelele uva valla
valle vapor vaso vela velador velero venado ventana ventilador ventisca verano vereda vergel vestido
vid vidrio vieira vinagre violeta visera vivero yate yema yeso yogur yunque zafiro zafra zanahoria
zapato zarza zarzamora zorro zorzal zueco zumo
`),
};
