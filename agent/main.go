// Live mesh agent : relie un ou plusieurs modules Meshtastic (USB/série ou Wi-Fi) à la carte live qui tourne sur le serveur.
//
// L'agent se connecte au serveur (par Tailscale ou le réseau local), se présente avec le code secret affiché
// dans la carte (Réseau › Modules), puis attend. Quand la carte choisit ce module, le serveur envoie « OUVRIR » :
// l'agent ouvre alors le port USB (ou la connexion Wi-Fi du module) et fait suivre le flux Meshtastic
// dans les deux sens, sans le modifier. Le module n'est occupé que pendant ce temps.
//
// Plusieurs connexions peuvent être gardées en mémoire (ex. « USB », « Le Monteil », « QRA ») : chacune apparaît
// dans la carte comme un module distinct, mais seulement quand le module est présent (port USB branché,
// ou module Wi-Fi sur le même réseau local que le PC).
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.bug.st/serial"
)

const version = "1.6"

// Une connexion gardée en mémoire : un module et le nom sous lequel il apparaît dans la carte
type Connexion struct {
	Nom    string `json:"nom"`    // nom affiché dans la carte (ex. Le Monteil)
	Source string `json:"source"` // port série (COM5, /dev/ttyACM0) ou adresse Wi-Fi du module (192.168.1.40[:4403])
	Debit  int    `json:"debit,omitempty"`
	// Module Wi-Fi joignable par une route (VPN, routeur) : ne pas exiger qu'il soit sur le réseau local du PC
	Toujours bool `json:"toujours,omitempty"`
}

type Reglages struct {
	Serveur    string      `json:"serveur"` // ex. 100.64.1.2:4404 (adresse Tailscale ou locale du serveur)
	Code       string      `json:"code"`    // code secret affiché dans la carte
	Connexions []Connexion `json:"connexions"`
	// La question du démarrage automatique a déjà été posée
	AutoDemande bool `json:"demarrageDemande,omitempty"`
	// Ancien format (agent ≤ 1.3) : une seule connexion, reprise automatiquement
	Nom    string `json:"nom,omitempty"`
	Source string `json:"source,omitempty"`
	Debit  int    `json:"debit,omitempty"`
}

var entree = bufio.NewReader(os.Stdin)
var muJournal sync.Mutex

func journal(format string, a ...any) {
	muJournal.Lock()
	defer muJournal.Unlock()
	fmt.Printf("%s  %s\n", time.Now().Format("15:04:05"), fmt.Sprintf(format, a...))
}

func demander(question, defaut string) string {
	if defaut != "" {
		fmt.Printf("%s [%s] : ", question, defaut)
	} else {
		fmt.Printf("%s : ", question)
	}
	l, _ := entree.ReadString('\n')
	l = strings.TrimSpace(l)
	if l == "" {
		return defaut
	}
	return l
}

func fichierReglages(chemin string) string {
	if chemin != "" {
		return chemin
	}
	exe, err := os.Executable()
	if err != nil {
		return "live-mesh-agent.json"
	}
	return filepath.Join(filepath.Dir(exe), "live-mesh-agent.json")
}

func charger(f string) Reglages {
	var r Reglages
	if b, err := os.ReadFile(f); err == nil {
		_ = json.Unmarshal(b, &r)
	}
	// Reprise de l'ancien format à une seule connexion
	if len(r.Connexions) == 0 && r.Source != "" {
		r.Connexions = []Connexion{{Nom: firstNonEmpty(r.Nom, "Module"), Source: r.Source, Debit: r.Debit}}
	}
	r.Nom, r.Source, r.Debit = "", "", 0
	return r
}

func enregistrer(f string, r Reglages) {
	b, _ := json.MarshalIndent(r, "", "  ")
	if err := os.WriteFile(f, b, 0600); err != nil {
		journal("settings not saved (%v)", err)
	} else {
		journal("settings saved in %s", f)
	}
}

// Module Wi-Fi : adresse IP (ou nom réseau avec un point), avec ou sans « :port ». Sinon : port série (COM5, /dev/ttyACM0).
func estReseau(source string) bool {
	s := strings.TrimSpace(source)
	if strings.HasPrefix(strings.ToUpper(s), "COM") || strings.HasPrefix(s, "/dev/") {
		return false
	}
	return regexp.MustCompile(`^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:\d+)?$`).MatchString(s)
}

// Adresse du module Wi-Fi avec le port Meshtastic par défaut (4403)
func adresseModule(source string) string {
	s := strings.TrimSpace(source)
	if regexp.MustCompile(`:\d+$`).MatchString(s) {
		return s
	}
	return s + ":4403"
}

// Le module est-il là ? USB : le port existe. Wi-Fi : son adresse est sur un réseau local du PC.
// (On ne se connecte pas au module pour vérifier : cela couperait l'appli du téléphone ou un autre client.)
func present(cx Connexion) (bool, string) {
	if !estReseau(cx.Source) {
		ports, _ := serial.GetPortsList()
		for _, p := range ports {
			if strings.EqualFold(p, cx.Source) {
				return true, ""
			}
		}
		return false, "port " + cx.Source + " missing (node unplugged?)"
	}
	if cx.Toujours {
		return true, ""
	}
	hote, _, err := net.SplitHostPort(adresseModule(cx.Source))
	if err != nil {
		return true, ""
	}
	ip := net.ParseIP(hote)
	if ip == nil {
		ips, err := net.LookupIP(hote)
		if err != nil || len(ips) == 0 {
			return false, "nom " + hote + " not found on this network"
		}
		ip = ips[0]
	}
	if ip.IsLoopback() {
		return true, ""
	}
	adresses, _ := net.InterfaceAddrs()
	for _, a := range adresses {
		if n, ok := a.(*net.IPNet); ok && n.Contains(ip) {
			ones, bits := n.Mask.Size()
			if ones < bits { // un /32 (Tailscale…) ne compte pas comme réseau local
				return true, ""
			}
		}
	}
	return false, "this PC is not on the network of " + hote
}

func decrire(cx Connexion) string {
	if estReseau(cx.Source) {
		return "Wi-Fi " + adresseModule(cx.Source)
	}
	return "USB " + cx.Source
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func normaliserNom(n string) string {
	return strings.ToLower(strings.TrimSpace(n))
}

// ---- Configuration interactive ----

func configurerServeur(r *Reglages) {
	fmt.Println()
	fmt.Println("=== Agent setup ===")
	fmt.Println("The secret code is in the map: Network › Nodes › “Node through an agent”.")
	for r.Serveur = demander("Address of the map server (Tailscale or local network) and port, e.g. 192.168.1.10:4404", r.Serveur); r.Serveur == ""; {
		r.Serveur = demander("Server address (required)", "")
	}
	if !strings.Contains(r.Serveur, ":") {
		r.Serveur += ":4404"
	}
	r.Code = demander("Map secret code", r.Code)
}

func saisirConnexion(r *Reglages, cx Connexion, exclure int) (Connexion, bool) {
	fmt.Println()
	for {
		cx.Nom = demander("Name of this node in the map (e.g. North Mountain, home, USB)", cx.Nom)
		if cx.Nom == "" {
			return cx, false
		}
		doublon := false
		for i, a := range r.Connexions {
			if i != exclure && normaliserNom(a.Nom) == normaliserNom(cx.Nom) {
				doublon = true
			}
		}
		if !doublon {
			break
		}
		fmt.Println("→ this name is already used by another connection, choose another one.")
		cx.Nom = ""
	}
	ports, _ := serial.GetPortsList()
	sort.Strings(ports)
	if len(ports) > 0 {
		fmt.Println("USB/serial ports found:", strings.Join(ports, ", "))
	} else {
		fmt.Println("No USB/serial port found (node unplugged?).")
	}
	def := cx.Source
	if def == "" && len(ports) > 0 {
		def = ports[len(ports)-1]
	}
	cx.Source = demander("Node: USB port (e.g. COM5) or the node's Wi-Fi address (e.g. 192.168.1.40)", def)
	if cx.Source == "" {
		return cx, false
	}
	if !estReseau(cx.Source) && cx.Debit == 0 {
		cx.Debit = 115200
	}
	if estReseau(cx.Source) {
		if ok, _ := present(Connexion{Source: cx.Source}); !ok {
			fmt.Println("(This PC is not on this node's network right now: normal if the node is elsewhere.")
			fmt.Println(" The agent will offer it to the map as soon as the PC is on that network.)")
		}
	}
	return cx, true
}

func afficherConnexions(r *Reglages) {
	fmt.Println()
	fmt.Println("Saved connections:")
	if len(r.Connexions) == 0 {
		fmt.Println("  (aucune)")
	}
	for i, cx := range r.Connexions {
		etat := "present"
		if ok, pourquoi := present(cx); !ok {
			etat = "missing: " + pourquoi
		}
		fmt.Printf("  %d. %-18s %-26s (%s)\n", i+1, cx.Nom, decrire(cx), etat)
	}
}

// Menu : ajouter, modifier, retirer des connexions
func gererConnexions(r *Reglages) {
	if len(r.Connexions) == 0 {
		if cx, ok := saisirConnexion(r, Connexion{}, -1); ok {
			r.Connexions = append(r.Connexions, cx)
		}
	}
	for {
		afficherConnexions(r)
		fmt.Println()
		fmt.Println("  a = add a connection   m N = modify no. N   r N = remove no. N   s = server and code")
		choix := strings.ToLower(demander("Your choice (Enter = finish and start the agent)", ""))
		if choix == "" {
			if len(r.Connexions) == 0 {
				fmt.Println("→ at least one connection is needed.")
				continue
			}
			return
		}
		champs := strings.Fields(choix)
		n := 0
		if len(champs) > 1 {
			n, _ = strconv.Atoi(champs[1])
		} else if len(champs[0]) > 1 {
			n, _ = strconv.Atoi(champs[0][1:])
		}
		switch champs[0][:1] {
		case "a":
			if cx, ok := saisirConnexion(r, Connexion{}, -1); ok {
				r.Connexions = append(r.Connexions, cx)
			}
		case "m":
			if n < 1 || n > len(r.Connexions) {
				fmt.Println("→ unknown number (e.g. “m 2”)")
				continue
			}
			if cx, ok := saisirConnexion(r, r.Connexions[n-1], n-1); ok {
				r.Connexions[n-1] = cx
			}
		case "r":
			if n < 1 || n > len(r.Connexions) {
				fmt.Println("→ unknown number (e.g. “r 2”)")
				continue
			}
			fmt.Printf("→ “%s” removed\n", r.Connexions[n-1].Nom)
			r.Connexions = append(r.Connexions[:n-1], r.Connexions[n:]...)
		case "s":
			configurerServeur(r)
		default:
			fmt.Println("→ choix inconnu")
		}
	}
}

func main() {
	chemin := flag.String("config", "", "settings file (default live-mesh-agent.json next to the program)")
	refaire := flag.Bool("configurer", false, "manage connections (add, modify, remove) and the server")
	ajouter := flag.Bool("ajouter", false, "add a connection")
	liste := flag.Bool("liste", false, "show saved connections")
	auto := flag.Bool("demarrage-auto", false, "start the agent automatically at login (Windows)")
	sansAuto := flag.Bool("sans-demarrage-auto", false, "ne plus lancer l'agent automatiquement")
	flag.Parse()
	if *sansAuto {
		retirerDemarrageAuto()
		return
	}

	fmt.Printf("Live mesh agent %s — relays Meshtastic and MeshCore nodes to the live map\n", version)
	f := fichierReglages(*chemin)
	r := charger(f)
	if *liste {
		afficherConnexions(&r)
		return
	}
	modifie := false
	if r.Serveur == "" || r.Code == "" {
		configurerServeur(&r)
		modifie = true
	}
	if *ajouter {
		if cx, ok := saisirConnexion(&r, Connexion{}, -1); ok {
			r.Connexions = append(r.Connexions, cx)
			modifie = true
		}
	}
	if *refaire || len(r.Connexions) == 0 {
		gererConnexions(&r)
		modifie = true
	}
	if modifie {
		enregistrer(f, r)
	}
	// Une seule fois : proposer le lancement automatique (plus besoin de relancer l'agent à la main)
	if runtime.GOOS == "windows" && !r.AutoDemande && !demarrageAutoActif() {
		if rep := strings.ToLower(demander("Start the agent automatically every time Windows starts? (y/n)", "y")); strings.HasPrefix(rep, "y") || strings.HasPrefix(rep, "o") {
			installerDemarrageAuto()
		}
		r.AutoDemande = true
		b, _ := json.MarshalIndent(r, "", "  ")
		_ = os.WriteFile(f, b, 0600)
	}
	if *auto {
		installerDemarrageAuto()
	}
	journal("map %s — %d connection(s): to add or remove some, run again with -configurer", r.Serveur, len(r.Connexions))
	var g sync.WaitGroup
	// Relais du réseau local : la carte peut joindre n'importe quel module Wi-Fi (Meshtastic ou MeshCore)
	// du réseau de ce PC à partir de sa seule adresse IP, sans rien configurer ici
	g.Add(1)
	go func() {
		defer g.Done()
		for {
			time.Sleep(boucleRelais(r.Serveur, r.Code))
		}
	}()
	for _, cx := range r.Connexions {
		g.Add(1)
		go func(cx Connexion) {
			defer g.Done()
			surveiller(r.Serveur, r.Code, cx)
		}(cx)
	}
	g.Wait()
}

// Une connexion : proposée à la carte tant que son module est présent
func surveiller(serveur, code string, cx Connexion) {
	dernier := ""
	for {
		if ok, pourquoi := present(cx); !ok {
			if pourquoi != dernier {
				journal("[%s] en attente : %s", cx.Nom, pourquoi)
				dernier = pourquoi
			}
			time.Sleep(20 * time.Second)
			continue
		}
		if dernier != "" {
			journal("[%s] node present again (%s)", cx.Nom, decrire(cx))
		}
		dernier = ""
		time.Sleep(boucle(serveur, code, cx))
	}
}

// Une session avec le serveur. Renvoie le délai avant la tentative suivante.
// Échecs consécutifs de dialogue avec la carte : le conseil sur le port 4404 n'est donné qu'après plusieurs essais
// (une seule coupure vient presque toujours d'un redémarrage de la carte, par exemple lors d'une mise à jour)
var echecsServeur int

func boucle(serveur, code string, cx Connexion) time.Duration {
	c, err := net.DialTimeout("tcp", serveur, 10*time.Second)
	if err != nil {
		journal("[%s] server unreachable (%v) — is Tailscale running? Retrying in 20 s", cx.Nom, err)
		return 20 * time.Second
	}
	defer c.Close()
	if tc, ok := c.(*net.TCPConn); ok {
		tc.SetKeepAlive(true)
		tc.SetKeepAlivePeriod(30 * time.Second)
		tc.SetNoDelay(true)
	}
	type bonjour struct {
		V       int    `json:"v"`
		Code    string `json:"code"`
		Nom     string `json:"nom"`
		Source  string `json:"source"`
		Version string `json:"version"`
	}
	b, _ := json.Marshal(bonjour{1, code, cx.Nom, decrire(cx), version})
	c.SetDeadline(time.Now().Add(15 * time.Second))
	if _, err := c.Write(append(b, '\n')); err != nil {
		journal("[%s] cannot send to the server (%v)", cx.Nom, err)
		return 20 * time.Second
	}
	lecteur := bufio.NewReader(c)
	l, err := lecteur.ReadString('\n')
	if err != nil {
		echecsServeur++
		if echecsServeur >= 4 {
			journal("[%s] the map still does not answer (%v) — is it running? is port 4404 open in docker-compose (never on your internet router)?", cx.Nom, err)
		} else {
			journal("[%s] the map does not answer yet (probably restarting, e.g. after an update): retrying in 30 s", cx.Nom)
		}
		return 30 * time.Second
	}
	l = strings.TrimSpace(l)
	if strings.HasPrefix(l, "ERREUR") {
		journal("[%s] refused by the map: %s", cx.Nom, strings.TrimSpace(strings.TrimPrefix(l, "ERREUR")))
		return 60 * time.Second
	}
	echecsServeur = 0
	journal("[%s] connected to the map, ready (%s)", cx.Nom, decrire(cx))
	c.SetDeadline(time.Time{})
	// Attente de l'ordre d'ouverture (le serveur envoie PING régulièrement)
	for {
		c.SetReadDeadline(time.Now().Add(3 * time.Minute))
		l, err = lecteur.ReadString('\n')
		if err != nil {
			journal("[%s] link with the map lost (map restarting?), reconnecting in 5 s", cx.Nom)
			return 5 * time.Second
		}
		if strings.TrimSpace(l) == "OUVRIR" {
			break
		}
		// « TCP 3232 » : relais vers un autre port du module Wi-Fi (mise à jour du firmware par le Wi-Fi)
		if strings.HasPrefix(strings.TrimSpace(l), "TCP ") {
			c.SetReadDeadline(time.Time{})
			return relayerPort(cx, c, lecteur, strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(l), "TCP ")))
		}
		// À chaque PING : si le module a disparu (USB débranché, PC changé de réseau), on se retire de la carte
		if ok, pourquoi := present(cx); !ok {
			journal("[%s] removed from the map: %s", cx.Nom, pourquoi)
			return time.Second
		}
	}
	c.SetReadDeadline(time.Time{})
	return relayer(cx, c, lecteur)
}

type moduleConn interface {
	io.ReadWriteCloser
}

func ouvrirModule(cx Connexion) (moduleConn, time.Duration, error) {
	if estReseau(cx.Source) {
		m, err := net.DialTimeout("tcp", adresseModule(cx.Source), 10*time.Second)
		return m, 0, err
	}
	debit := cx.Debit
	if debit == 0 {
		debit = 115200
	}
	// DTR et RTS au repos : évite de redémarrer les cartes ESP32 à l'ouverture du port
	p, err := serial.Open(cx.Source, &serial.Mode{BaudRate: debit, InitialStatusBits: &serial.ModemOutputBits{DTR: false, RTS: false}})
	if err != nil {
		// Certains ports (adaptateurs virtuels) refusent le réglage DTR/RTS : ouverture simple
		var err2 error
		p, err2 = serial.Open(cx.Source, &serial.Mode{BaudRate: debit})
		if err2 != nil {
			return nil, 0, err
		}
	}
	// Si la carte redémarre malgré tout, on lui laisse le temps de démarrer avant d'envoyer
	return p, 3 * time.Second, nil
}

func relayer(cx Connexion, c net.Conn, lecteur *bufio.Reader) time.Duration {
	m, delai, err := ouvrirModule(cx)
	if err != nil {
		journal("[%s] cannot open node %s: %v", cx.Nom, cx.Source, err)
		if !estReseau(cx.Source) {
			journal("[%s] → port used by the Meshtastic app, the map page (“Plug in over USB”) or another program?", cx.Nom)
		}
		return 15 * time.Second
	}
	journal("[%s] module %s ouvert, relais actif", cx.Nom, cx.Source)
	debut := time.Now()
	var once sync.Once
	fin := make(chan struct{})
	fermer := func() { once.Do(func() { c.Close(); m.Close(); close(fin) }) }
	var versModule, versCarte int64
	cote := ""
	var mu sync.Mutex
	marquer := func(t string) {
		mu.Lock()
		if cote == "" {
			cote = t
		}
		mu.Unlock()
	}
	go func() { // module → carte
		n, _ := io.Copy(c, m)
		versCarte = n
		marquer("the node closed the link (another client on the node? phone app over Wi-Fi?)")
		fermer()
	}()
	go func() { // carte → module (après le délai de démarrage éventuel)
		if delai > 0 {
			time.Sleep(delai)
		}
		n, _ := io.Copy(m, lecteur)
		versModule = n
		marquer("the map closed the link (another node chosen, or disconnection)")
		fermer()
	}()
	<-fin
	journal("[%s] relay ended after %s: %s (%d bytes received from the node, %d sent)", cx.Nom, time.Since(debut).Round(time.Second), cote, versCarte, versModule)
	return 5 * time.Second
}

// Relais vers un autre port TCP du module Wi-Fi (seulement 3232 : chargeur de mise à jour du firmware)
func relayerPort(cx Connexion, c net.Conn, lecteur *bufio.Reader, port string) time.Duration {
	if port != "3232" || !estReseau(cx.Source) {
		journal("[%s] request refused: port %s (only the Wi-Fi update of a networked node is relayed)", cx.Nom, port)
		return 5 * time.Second
	}
	hote := strings.TrimSpace(cx.Source)
	if i := strings.LastIndex(hote, ":"); i > 0 {
		hote = hote[:i]
	}
	var m net.Conn
	var err error
	for essai := 0; essai < 3; essai++ {
		if m, err = net.DialTimeout("tcp", hote+":"+port, 10*time.Second); err == nil {
			break
		}
		time.Sleep(2 * time.Second)
	}
	if err != nil {
		journal("[%s] update: node loader unreachable on %s:%s (%v)", cx.Nom, hote, port, err)
		return 5 * time.Second
	}
	journal("[%s] firmware update: relaying to %s:%s", cx.Nom, hote, port)
	var once sync.Once
	fin := make(chan struct{})
	fermer := func() { once.Do(func() { c.Close(); m.Close(); close(fin) }) }
	go func() { io.Copy(c, m); fermer() }()
	go func() { io.Copy(m, lecteur); fermer() }()
	<-fin
	journal("[%s] update relay finished", cx.Nom)
	return 3 * time.Second
}

// ---- Démarrage automatique (Windows : petit fichier dans le dossier « Démarrage » de la session) ----
func fichierDemarrage() string {
	appdata := os.Getenv("APPDATA")
	if appdata == "" {
		return ""
	}
	return filepath.Join(appdata, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "live-mesh-agent.cmd")
}

func demarrageAutoActif() bool {
	f := fichierDemarrage()
	if f == "" {
		return false
	}
	_, err := os.Stat(f)
	return err == nil
}

func installerDemarrageAuto() {
	if runtime.GOOS != "windows" {
		journal("automatic start: on Linux / Raspberry Pi, create a systemd service (see the repository README)")
		return
	}
	exe, err := os.Executable()
	if err != nil {
		journal("automatic start impossible (%v)", err)
		return
	}
	contenu := "@echo off\r\nrem Live mesh agent: links Meshtastic nodes to the live map\r\nstart \"Live mesh agent\" /min \"" + exe + "\"\r\n"
	if err := os.WriteFile(fichierDemarrage(), []byte(contenu), 0644); err != nil {
		journal("automatic start impossible (%v)", err)
		return
	}
	journal("the agent will start by itself (minimized) at every Windows login. To stop that: -sans-demarrage-auto")
}

func retirerDemarrageAuto() {
	if f := fichierDemarrage(); f != "" {
		if err := os.Remove(f); err == nil {
			journal("automatic start removed")
			return
		}
	}
	journal("automatic start was not enabled")
}

// ---- Relais du réseau local (agent 1.6) -------------------------------------------------------------
// Une session de plus, sans module attitré : la carte peut lui demander de sonder une adresse IP du réseau
// local (ports 4403 Meshtastic et 5000 MeshCore) puis de relayer l'un de ces deux ports.
// Seules les adresses privées des réseaux auxquels ce PC est branché sont acceptées.

const portMeshtastic, portMeshCore = "4403", "5000"

// Réseaux locaux du PC (hors /32 type Tailscale et hors boucle locale)
func reseauxLocaux() []*net.IPNet {
	var l []*net.IPNet
	adresses, _ := net.InterfaceAddrs()
	for _, a := range adresses {
		if n, ok := a.(*net.IPNet); ok && n.IP.To4() != nil && !n.IP.IsLoopback() {
			if ones, bits := n.Mask.Size(); ones < bits && ones >= 16 {
				l = append(l, n)
			}
		}
	}
	return l
}

func adresseAutorisee(ip string) bool {
	p := net.ParseIP(strings.TrimSpace(ip))
	if p == nil || p.To4() == nil || !p.IsPrivate() {
		return false
	}
	for _, n := range reseauxLocaux() {
		if n.Contains(p) {
			return true
		}
	}
	return false
}

func nomPC() string {
	h, err := os.Hostname()
	if err != nil || h == "" {
		h = "PC"
	}
	return h
}

func sonderPort(ip, port string) bool {
	m, err := net.DialTimeout("tcp", net.JoinHostPort(ip, port), 2500*time.Millisecond)
	if err != nil {
		return false
	}
	m.Close()
	return true
}

func boucleRelais(serveur, code string) time.Duration {
	nom := nomPC() + " · local network"
	c, err := net.DialTimeout("tcp", serveur, 10*time.Second)
	if err != nil {
		return 30 * time.Second
	}
	defer c.Close()
	if tc, ok := c.(*net.TCPConn); ok {
		tc.SetKeepAlive(true)
		tc.SetKeepAlivePeriod(30 * time.Second)
		tc.SetNoDelay(true)
	}
	var reseaux []string
	for _, n := range reseauxLocaux() {
		reseaux = append(reseaux, n.String())
	}
	type bonjour struct {
		V       int      `json:"v"`
		Code    string   `json:"code"`
		Nom     string   `json:"nom"`
		Source  string   `json:"source"`
		Version string   `json:"version"`
		Relais  bool     `json:"relais"`
		Reseaux []string `json:"reseaux"`
	}
	b, _ := json.Marshal(bonjour{1, code, nom, "local network relay " + strings.Join(reseaux, ", "), version, true, reseaux})
	c.SetDeadline(time.Now().Add(15 * time.Second))
	if _, err := c.Write(append(b, '\n')); err != nil {
		return 30 * time.Second
	}
	lecteur := bufio.NewReader(c)
	l, err := lecteur.ReadString('\n')
	if err != nil || strings.HasPrefix(strings.TrimSpace(l), "ERREUR") {
		return 60 * time.Second
	}
	c.SetDeadline(time.Time{})
	for {
		c.SetReadDeadline(time.Now().Add(3 * time.Minute))
		l, err = lecteur.ReadString('\n')
		if err != nil {
			return 5 * time.Second
		}
		l = strings.TrimSpace(l)
		switch {
		case strings.HasPrefix(l, "SONDER "):
			ip := strings.TrimSpace(strings.TrimPrefix(l, "SONDER "))
			var ports []string
			if adresseAutorisee(ip) {
				for _, p := range []string{portMeshtastic, portMeshCore} {
					if sonderPort(ip, p) {
						ports = append(ports, p)
					}
				}
				journal("[local network] %s: %s", ip, map[bool]string{true: "ports " + strings.Join(ports, ", "), false: "no reachable node"}[len(ports) > 0])
			} else {
				journal("[local network] %s refused (address outside this PC's local networks)", ip)
				c.Write([]byte("HORS\n"))
				continue
			}
			c.Write([]byte("PORTS " + strings.Join(ports, ",") + "\n"))
		case strings.HasPrefix(l, "RELAIS "):
			hote, port, err := net.SplitHostPort(strings.TrimSpace(strings.TrimPrefix(l, "RELAIS ")))
			if err != nil || !adresseAutorisee(hote) || (port != portMeshtastic && port != portMeshCore) {
				journal("[local network] relay refused: %s", l)
				return 5 * time.Second
			}
			c.SetReadDeadline(time.Time{})
			m, err := net.DialTimeout("tcp", net.JoinHostPort(hote, port), 10*time.Second)
			if err != nil {
				journal("[local network] %s:%s unreachable: %v", hote, port, err)
				return 5 * time.Second
			}
			journal("[local network] relay active to %s:%s", hote, port)
			debut := time.Now()
			var once sync.Once
			fin := make(chan struct{})
			fermer := func() { once.Do(func() { c.Close(); m.Close(); close(fin) }) }
			go func() { io.Copy(c, m); fermer() }()
			go func() { io.Copy(m, lecteur); fermer() }()
			<-fin
			journal("[local network] relay to %s:%s ended after %s", hote, port, time.Since(debut).Round(time.Second))
			return 3 * time.Second
		}
	}
}
