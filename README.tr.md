# Mateless

**Bu taraf hâlâ mat edebilir mi?** Mateless bu soruyu bir satranç oyununun her hamlesinden sonra,
iki taraf için de cevaplıyor ve cevabı saklıyor: mat edemeyeceği ispatlanan taraf oyunun geri
kalanında da mat edemez. FIDE kuralları bu soruyu üç anda soruyor:

- **süre bitimi** (FIDE 6.9): süresi biten oyuncu kaybeder; ama rakip hiçbir yasal hamle
  dizisiyle mat edemiyorsa oyun berabere biter;
- **terk** (FIDE 5.1.2): aynı soru, aynı cevap;
- **ölü pozisyon** (FIDE 5.2.2): iki taraf da mat edemiyorsa oyun o an berabere biter.

Mateless bir kütüphane (JavaScript, Rust, WebAssembly; bağımlılık yok) ve bir hakem sayfası.
**Sağlam ama eksik**: ispatı olmadan hiçbir zaman beraberlik demiyor; ispatlayamadığını
platformun kuralına (süresi biten kaybeder) ve oyundan sonra tam bir çözücüye bırakıyor.

[English](README.md) · [Tasarım](docs/DESIGN.md) · [Sonuçlar](docs/RESULTS.md) ·
[Lichess için: mateless-scalachess](https://github.com/cuneytinann/mateless-scalachess)
(belgeler İngilizce)

## En küçük parçaya değil, bütüne bakan bir tespit

Mateless'in merkezinde bir **kilit dedektörü** var: hiçbir yasal hamle dizisinin açamayacağı
piyon, şah ve fil yapılarını tek bir hamle üretmeden, yaklaşık 90 nanosaniyede tanıyor.

Alanın referansı [chasolver](https://github.com/miguel-ambrona/chasolver) (Miguel Ambrona, FUN 2022)
en küçük parçalardan yukarı çıkıyor: kısa bir aramadan sonra pozisyonu taş taş inceliyor, her taş
için ayrı bir erişim kümesi, ardından mat ağı için kombinatoryal bir kontrol. Mateless bütüne bir
kerede bakıyor: bir tarafın bütün piyonları tek bir koni, bir şah tek bir erişim kümesi; birkaç
bitboard işlemi bütün yapıyı bir sabit noktaya taşıyor. Aşağıdaki Lichess verisinin kilitli
pozisyonlarında bu, chasolver'ın hızlı kontrolünden **~70 kat hızlı** (Rust'a karşı Rust);
arkasındaki kısa aramayla Mateless o verinin **%99,98'ini** ~17–18 kat hızlı kapsıyor.

chasolver tam bir çözücü: Mateless'in denemediği bestelenmiş problemleri de çözüyor. Mateless tam
bir çözücünün önüne konan hızlı katman; bir oyun sunucusunun içinde her hamlede çalışacak kadar
küçük.

## Hız

Kilitli bir pozisyon **yaklaşık 90 nanosaniyede** ispatlanıyor (Rust; pozisyon önbellekteyken
~60 ns). Gerçek bir oyundan, tahtasında at, kale ya da vezir olan bir pozisyonu kilit dedektörü
**~9 ns'de** eliyor. Merdivenin tamamı Lichess süre bitimi başına ortalama **~0,23 µs**; bir
oyunu izlemek, iki tarafın bayrağı için **hamle başına ~0,35 µs**.

| | Rust | JavaScript |
|---|---|---|
| kilitli bir pozisyon, ispatıyla | ~60–90 ns | ~0,2–0,8 µs |
| gerçek oyun pozisyonu, kilit dedektörü (tahtada at, kale ya da vezir) | ~9 ns | |
| merdivenin tamamı, Lichess süre bitimi başına (201.060 satır) | ~0,23 µs | ~0,9 µs |
| bir oyunun iki bayrağı, hamle başına | ~0,35 µs | ~1,6 µs |

chasolver'ın hızlı kontrolüne karşı, ikisi de Rust'ta, chasolver'ın kendi derleme ayarlarıyla tek
bir ikili dosyada (pozisyonlar önceden okunuyor, 64'lük parçalar dönüşümlü sırayla, 7 turun
ortancası; `rust/examples/vs_chasolver.rs`):

| küme | pozisyon | chasolver hızlı kontrol | Mateless | oran |
|---|---|---|---|---|
| **kilitli** | 50.970 | 6,46–6,52 µs | 0,093 µs | **~70×** |
| kilitli, yalnızca hesap (512, önbellek sıcak) | 512 | 5,70–5,77 µs | 0,058–0,062 µs | **~93–100×** |
| zorunlu çizgiler | 141.941 | 0,90–0,91 µs | 0,237 µs | ~3,8× |
| malzeme | 8.139 | 0,30 µs | 0,011 µs | ~27× |
| **201.060 Lichess satırının tamamı** | 201.060 | 3,97–4,05 µs | 0,224–0,235 µs | **~17–18×** |
| iki taraf birden, bütün satırlar | 201.060 | 6,52 µs (iki çağrı) | 0,41 µs | **~16×** |
| gerçek oyun pozisyonları (chasolver'ın `lichess.txt`'i, iki taraf) | 131.072 | 2,41 µs | 0,563 µs | ~4,3× |

chasolver 201.060 satırın hepsini, Mateless 201.024'ünü ispatlıyor. Tarayıcı aynı motoru
çalıştırıyor: hakem sayfası kilitli bir pozisyonu bir mikrosaniyenin altında ispatlıyor;
WebAssembly bütün ispatlarda JavaScript'ten 2,5–4 kat hızlı. Ayrıntılar ve JavaScript'e karşı
JavaScript karşılaştırmasının neden Mateless'i olduğundan iyi gösterdiği (~85–95×)
[docs/RESULTS.md](docs/RESULTS.md)'de.

## Merdiven

Her hamleden sonra bayrağı hâlâ yerinde olan her taraf bir merdiven çıkıyor. O tarafın bir daha
hiç mat edemeyeceğini ispatlayan ilk basamak bayrağını indiriyor, kalıcı olarak.

| basamak | ne zaman | neyi ispatlıyor | süre (JS; Rust 3–5 kat hızlı) |
|---|---|---|---|
| **1. malzeme testi** | alıştan ya da piyon hamlesinden sonra (aramada: alış ya da terfiden sonra) | mat için malzeme hiç yetmiyor | ~0,1 µs |
| **2. kilit dedektörü** | alıştan, piyon hamlesinden, en passant hakkının düşmesinden ya da şahın piyon şahından çıkmasından sonra | piyon, şah ve fil yapısı hiçbir yasal hamle dizisiyle açılamıyor (tahtada at, kale ya da vezir varsa hemen düşüyor) | ~0,3–0,8 µs |
| **3. Domino araması** | her hamleden sonra | 6 ply ve 100 düğümlük bir helpmate araması mat bulmuyor; her dizi görülmüş bir pozisyonda, statik bir ispatta ya da patta bitiyor | ~1–5 µs |

- **İki bayrak da düştüyse** pozisyon ölü (FIDE 5.2.2): oyun berabere biter.
- **Süre bitince ya da bir taraf terk edince** hesap yapılmaz: rakibin bayrağı düşmüşse
  beraberlik (FIDE 6.9, 5.1.2), düşmemişse kayıp.
- İki taraf tek geçişte inceleniyor: kilit dedektörünün taraftan bağımsız kısmı ve iki aramanın
  yürüyüşü ortak.
- Statik testler yalnızca cevaplarını değiştirebilecek bir hamleden sonra soruluyor
  (`testsAfter`). Bunun için bayraklar bir önceki ply'dan iki şey hatırlıyor: en passant karesi
  var mıydı, sıradaki taraf piyon şahında mıydı. Ply atlanırsa ya da hamle geri alınırsa
  pozisyonun kendisi karar veriyor (yarım hamle sayacı en fazla 1 ise iki test de).
- **Hiçbir hamle sayacı kuralı ispata katılmıyor:** 50 ve 75 hamle kuralları ve tekrarlar dizileri
  yalnızca kısaltır; onları dışarıda bırakmak bir ispatı kaybettirebilir, yanlış bir ispat
  üretemez.

> **Hamle geri alma.** Düşen bir bayrak, o pozisyondan sonra gelen her pozisyon için geçerli.
> Hamle geri almaya izin veren bir platform, oyunun döndüğü ply'la `flags.rewind(ply)` çağırır
> (bir `Game`'de `game.flags.rewind(ply)`; JS, Rust ve WebAssembly'de aynı): o ply'dan sonra
> düşen bayraklar yeniden kalkar.

**Oyun sonu kuralları.** Mateless yalnızca iddia gerektirmeyen bitişlere karar veriyor: mat, pat,
ölü pozisyon, 75 hamle kuralı ve beşli tekrar (FIDE 9.6). Üçlü tekrar (9.2) ve 50 hamle kuralı
(9.3) iddiayla, anlaşmalı beraberlik anlaşmayla olur: bunlar platformun işi. `Game` tekrar
sayısını, her pozisyon kendi yarım hamle sayacını tutuyor.

## Sonuçlar

**Veri.** Miguel Ambrona'nın chasolver projesi, rakip hiçbir zaman mat edemeyecekken süreden
kaybedilmiş dereceli Lichess oyunlarını topluyor ve CSV dosyaları olarak
[chasolver.org/unfair-games](https://chasolver.org/unfair-games) adresinde yayımlıyor: 31 Temmuz
2026'ya kadar 201.060 oyun, hepsi yanlış sonuçlanmış. İki sınıf Lichess'te artık görülmüyor ve yayımlanan kümeden çıkarılmış:
malzeme (8.139 satır; Lichess bunu 2020 civarında düzeltmiş) ve sunucu patları (464 satır; kısa
süreli bir hata). Ağustos ve eylül 2026, Lichess'in kendi aylık veritabanlarının taranmasından
geliyor (181,5 milyon dereceli oyun): süreden kaybedilmiş ve kazananın hiçbir zaman mat
edemeyeceğini hem chasolver'ın hem Mateless'in ispatladığı 2.830 oyun (kural ihlaliyle kazanılan
oyunlar dışarıda). 195.287 satır, Mateless'in sınıflamasıyla (JS, Rust ve WebAssembly her satırda
aynı cevabı veriyor):

| sınıf | satır | pay | Lichess bugün berabere veriyor (scalachess 18.0.1) | kilit yamasıyla berabere |
|---|---|---|---|---|
| **kilitli pozisyonlar** (kilit dedektörü) | **52.050** | %26,7 | 141 | **52.050** |
| zorunlu çizgiler (Domino araması) | 143.201 | %73,3 | 138.431 | 138.669 |
| ispatlanamayan | 36 | %0,018 | 0 | 0 |
| **hepsi** | **195.287** | | **138.572** (%71,0) | **190.719** (%97,7) |

Lichess bugün zorunlu çizgilerin çoğunu berabere veriyor: scalachess #821 (Ağustos 2026'da
birleşti; veriye göre Lichess'te 6 Eylül'den beri kullanılıyor), lila'nın süre bitince sorduğu
teste bir hamlelik ileri bakış ekledi. Hâlâ kaçırdıkları neredeyse tamamen **kilitli
pozisyonlar**: 56.715 kaçırılan satırın 51.909'u. 7–30 Eylül'de, #821 kullanılırken, 460 oyun yine
böyle süreden kaybedildi; 422'si (%92) kilitti ve kilit yaması hepsini berabere veriyor. Kilit
yaması [mateless-scalachess](https://github.com/cuneytinann/mateless-scalachess)'teki `a-lock`:
yalnızca kilit dedektörü (181 satır Scala), hem pozisyonun kendisinde hem #821'in ileri bakışında.
Merdivenin tamamı, Mateless'in kendisi ya da o repodaki `c-ladder` yaması, 195.251 satırı
(%99,98) berabere veriyor.

Satırların 117.455'inde (%60) son pozisyon zaten ölüydü, iki taraf da mat edemiyordu: FIDE 5.2.2'ye
göre bu oyunlar süre bitmeden önce berabere bitmişti.

Sınıflama [`data/`](data) klasöründe, en yeni oyun en üstte: `timeouts_classified.tsv` (her satır:
oyun kimliği, tarih, sınıf, Lichess bugün, kilit yamasıyla, ölü pozisyon), `locked_positions.tsv`
(52.050 kilitli pozisyon, mat edemeyen tarafla) ve `lichess_2026-08_09.tsv` (taranan satırlar son
pozisyonlarıyla; yanlarında rakip hiçbir zaman mat edemezken terk edilen 170 oyun: FIDE 5.1.2'ye
göre beraberlik, Lichess ise her terki kayıp sayıyor). İspatlanamayan 36 satırın 32'si,
ulaşılabilen pozisyonları arasında pat bulunan kafesler (çoğu köşeye kapanmış bir şah, son piyonu
almak pat getiriyor; 6'sında vezir ya da kale var), 3'ü önü açık bir piyon çifti (bir sütunda bir
beyaz ve bir siyah piyon, aralarında tek boş kare, yapının geri kalanı kilitli), 1'i kendi
piyonlarının arasına kapanmış bir at. Oyundan sonra bir puan iadesinin kapsayacağı şey bunlar ve
platformun kendi kurallarının bıraktıkları: oyun bittikten sonra tam bir çözücü (chasolver) onlara
bakar. Merdivenin tamamıyla bu 195.287 satırda 36 satır; bugünkü Lichess'in üstüne yalnızca kilit
dedektörüyle 4.568.

**Sağlamlık.** Henüz yazılı bir ispat yok; güçlü test kanıtı var.
- chasolver'ın etiketlerine karşı yanlış beraberlik yok (68.950 etiketli pozisyonu, iki taraf;
  `test/classify.js`). Hamle hamle oynanan ~10.000 oyunda düşen ~5.700 bayrağın hiçbirinde
  chasolver'ın tam çözücüsü mat bulmadı (`test/game_flags_check.js`).
- Kilit dedektörünün fuzz pozisyonlarındaki (chasolver pozisyonlarının mutasyonları ve rastgele
  kilitli yapılar) sertifikalarının hepsine chasolver'ın tam araması "kazanılamaz" diyor: yeni bir
  koşuda 23.001'in 23.001'i, önceki koşularda 54.587 (`test/fuzz_lock_gen.js`,
  `rust/examples/oracle.rs`).
- **Değişmez kontrolü** (`test/lock_invariant.js`) hükmü değil gerekçeyi sınıyor: her kilit
  sertifikasından ulaşılabilen pozisyonları dolaşıyor ve her birinin sertifikanın iddiasını
  koruduğunu kontrol ediyor (piyonlar konilerinde, sabit piyonlar yerinde, şahlar ve filler erişim
  kümelerinde, terfi yok, mat yok). Temmuz 2026'ya kadarki 50.970 kilitli pozisyonun hepsinde,
  dolaşılan 271,8 milyon pozisyonda ihlal yok; 50.692'sinde ulaşılabilir küme sonuna kadar
  dolaşıldı, bu o pozisyon için bir ispat. Ağustos ve eylülün 1.175 kilidinde (süre kayıpları ve
  terkler) 5,8 milyon pozisyonda ihlal yok, 1.171'i sonuna kadar dolaşıldı.

## Kullanım

**Sayfalar.** İki sayfa, tek görünüm; tarayıcıda açılır, kurulum gerekmez (GitHub Pages açıkken
`index.html` sitenin ön sayfası olur). Varsayılan dil İngilizce; Türkçe seçilebilir.
- `index.html`, hakem: bir FEN, CSV ya da TXT pozisyon dosyaları ya da PGN oyunları. Her hüküm bir
  skor ve gerekçesiyle (yetersiz materyal, kilitli pozisyon, Domino etkisi, mat bulundu, ispat yok)
  ve ona götüren basamaklarla gösterilir; ölü pozisyonlar işaretlenir; sonuçlar CSV olarak
  indirilir. chasolver'ın, berabere bitmesi gerekirken süreden kaybedilmiş Lichess oyunları
  listeleri ([chasolver.org/unfair-games](https://chasolver.org/unfair-games)) doğrudan bırakılabilir.
- `chasolver.html`: Miguel Ambrona'nın chasolver 3.0.0'ının JavaScript çevirisi (resmi değil; MIT),
  tam çözücü; kazanılabilir her pozisyon için bir mat hattı gösterir. 398.960 girdide hızlı kontrolü
  resmi Rust sürümüyle her satırda aynı cevabı verdi. Hakem sayfasındaki "chasolver'a sor" düğmesi
  pozisyonu ona aktarır; JS ölçümleri chasolver'ı bu sayfadan alıyor.

Hakem sayfası motoru gömülü taşıyor; `src/` değişince:

```sh
node tools/build.js && node tools/embed-engine.js
```

**Node:**

```js
const E = require('./mateless.js');
const { position } = E.fromFen('8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3K4 b - - 47 92');

E.cannotMate(position, E.BLACK);          // true: Siyah'ın süresi bitse bile Beyaz mat edemez (statik)
E.lockCannotMate(position, E.BLACK);      // true: bunu kilit dedektörü ispatlıyor
E.proveCannotBeMated(position, E.BLACK);  // { proven: true, staticProof: true, failure: null, foundBy: null, nodes: 0 }
E.cannotMate2(position, E.FLAGGED_WHITE | E.FLAGGED_BLACK);   // 3: iki taraf da mat edilemez (tek geçişte)
E.proveBoth(position);                    // [Beyaz için, Siyah için]: iki ispat tek geçişte
E.RESULT_NAMES[E.flagVerdict(position, E.BLACK)];   // 'draw on time': süreden beraberlik
E.RESULT_NAMES[E.gameStatus(position)];             // 'dead position': ölü pozisyon, oyun zaten bitmiş

// Hamle hamle oynanan oyun: bayraklar her hamleyi izler, süre bitimi bayraklardan okunur.
const game = new E.Game(E.fromFen('7k/8/8/8/3q4/8/8/7K w - - 0 60').position);
E.RESULT_NAMES[game.status()];                      // 'ongoing': oyun sürüyor
game.neverMates(E.WHITE);                           // true: Beyaz'ın yalnızca şahı var, bayrağı düştü
game.neverMates(E.BLACK);                           // false
E.RESULT_NAMES[game.flagVerdict(E.BLACK)];          // 'draw on time': Siyah'ın süresi biterse beraberlik
E.RESULT_NAMES[game.flagVerdict(E.WHITE)];          // 'black wins on time': Beyaz'ın süresi biterse Siyah kazanır
E.RESULT_NAMES[game.flagVerdict(E.BLACK, { resigned: true })];   // 'draw on resignation': Siyah terk ederse de beraberlik (FIDE 5.1.2)
game.play(E.parseSquare('h1'), E.parseSquare('g2'));   // Beyaz bir daha incelenmez

// Kendi oyun nesnesi olan bir platform yalnızca bayrakları tutar: yeni pozisyon ve ply'ı.
const flags = new E.Flags();
flags.update(position, 0);                          // ilk pozisyon (ply 0): iki taraf da kilitli
flags.neverMates(E.WHITE) && flags.neverMates(E.BLACK);   // true: ölü pozisyon
```

`mateless.js` hem klasik `<script>` olarak (`globalThis.Mateless`) hem Node modülü olarak çalışıyor;
`mateless.mjs` aynı tek dosyanın ES modülü hali (`import { fromFen, proveBoth } from
'./mateless.mjs'` ya da `import Mateless from './mateless.mjs'`). Kaynak modüller
(`./src/index.js`) aynı cevapları veriyor ama V8'de ~%10–30 yavaş.

**WebAssembly.** Rust çevirisi `mateless.wasm` olarak derlendi (84 KB); bağımlılıksız köprüsü
`mateless-wasm.js`. Merdivenin tamamını veriyor (statik testler, Domino, iki ispat, bir oyunun
bayrakları, perft), `mateless.js` ile düğüm sayısına kadar aynı cevaplarla. İspatlar JS'ten ~2,5–4
kat, bir oyunun bayrakları ply başına ~3,2 kat hızlı; yerel Rust bundan da ~1,5–1,9 kat hızlı.
Yeniden derlemek için `node tools/build-wasm.js`.

```js
const W = require('./mateless-wasm.js').instantiate(require('fs').readFileSync('mateless.wasm'));   // tarayıcıda: await MatelessWasm.load('mateless.wasm')
W.proveBoth('8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3K4 b - - 47 92');   // [Beyaz için, Siyah için], mateless.js'tekiyle aynı
const flags = new W.Flags();                                // bir oyunun bayrakları
flags.update(fen, ply);                                     // her hamleden sonra, FEN ya da W.fromFen(fen).position ile
```

**Rust** ([rust/README.md](rust/README.md)):

```rust
let pos = mateless::from_fen("8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3K4 b - - 47 92").unwrap();
let mut search = mateless::Domino::new();
let proof = mateless::prove_cannot_be_mated(&mut search, &pos, mateless::BLACK, mateless::DOMINO_PLY, mateless::DOMINO_BUDGET);
assert!(proof.proven && proof.static_proof);    // kilit dedektörü: Beyaz hiçbir zaman mat edemez
```

**TypeScript.** Tipler motorun yanındaki `mateless.d.ts`'te; TypeScript onları kendiliğinden buluyor:

```ts
import Mateless = require('./mateless');      // ya da: import { fromFen, proveBoth } from './mateless';
const r = Mateless.fromFen('8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3K4 b - - 47 92');
if (r.error === undefined) Mateless.proveCannotBeMated(r.position, Mateless.BLACK);   // Proof
```

**scalachess (Lichess)** için ayrı bir repo var:
[mateless-scalachess](https://github.com/cuneytinann/mateless-scalachess). scalachess 18.0.1'e iki
yama seti: yalnızca kilit dedektörü (önerilen) ve merdivenin tamamı (başvuru için).

## Yalnızca kilit dedektörünü almak

Merdivenin geri kalanı olmadan yalnızca kilit dedektörünü almak isteyen bir platform için.

**Ne istiyor:** piyonların, şahların ve fillerin (renkleriyle) bitboard'ları, tahtada at, kale ya
da vezir olup olmadığı ve en passant karesi (yalnızca o kareye yasal bir alış varsa). Hamle
üretmiyor, aramıyor.

| dil | fonksiyon |
|---|---|
| JS | `lockCannotMate(pos, flagged)` (`src/lock.js`) |
| WebAssembly | `lockCannotMate(fen ya da Position, flagged)` (`mateless-wasm.js`) |
| Rust | `lock_test(&pos, flagged)` (`rust/src/lock.rs`) |
| Scala (scalachess) | `chess.mateless.Lock.cannotBeMated(position, flagged)` (mateless-scalachess, `a-lock`) |

**Maliyeti** (çağrı başına):

| | Rust | JS | Scala (scalachess) |
|---|---|---|---|
| tahtada at, kale ya da vezir var (oyunun çoğu): hemen çıkıyor | ~9 ns | | ~30–35 ns |
| kilitli pozisyon (sabit noktanın tamamı) | ~105 ns | ~0,3–0,8 µs | ~150–190 ns |

**Tek başına neyi görür:** pozisyonun kendisinde duran bir kilidi: yukarıdaki 195.287 Lichess
satırının 52.050'si, Lichess'in bugün kaçırdığı 51.909'u dahil.

**Neyi görmez:** bir hamle ötedeki kilidi.
1. **Piyon şahından çıkış.** Piyon şahındaki şah, erişim kümesinin dışarıda bıraktığı bir karede
   duruyor; oradan çıkınca kilit tamamlanabiliyor. `8/8/1k6/p2p2p1/PK1P2Pp/7P/8/8 w`: Beyaz'ın her
   şah hamlesi kilide giriyor.
2. **Zorunlu alış.** Son atı, kaleyi ya da veziri almak tek hamleyse, alıştan sonra bir kilit (ya da
   çıplak malzeme) geliyor. `8/8/6R1/1p1p1k2/1P1Pp3/4P1p1/6P1/6K1 b`: Şxg6 tek hamle.
3. **En passant hakkının düşmesi.** Hak dururken dedektör başarısız; sonraki herhangi bir hamle hakkı
   düşürüyor.

**Bunları kapsamanın iki yolu:**
- **Bir hamlelik ileri bakışı olan platform** (scalachess #821 gibi: süresi biten tarafın her
  hamlesine bakıyor): kilidi pozisyonda ve her çocuk pozisyonda sor. Üç durum da kendiliğinden
  gelir; çocuk pozisyonda en passant hakkı kalmamıştır. Lichess verisinde bu 238 satır ekledi:
  237'si piyon şahından çıkış, 1'i zorunlu kale alışı.
  ```
  süre bitince beraberlik  ⇔  kilit(pozisyon)
                              ya da süresi biten tarafın her yasal hamlesinden sonra: onun verdiği
                              bir mat, pat, rakip için yetersiz malzeme ya da kilit(o pozisyon)
  ```
- **Oyunu hamle hamle izleyen platform:** kilidi bir alıştan, piyon hamlesinden, en passant hakkı
  varken yapılan bir hamleden ve piyon şahından çıkan bir hamleden sonra sor; ispatı oyunun geri
  kalanı için tut. Mateless'in tetikleyicisi ve bayrakları tam olarak bu (`testsAfter`, `Flags`).
  Üç durumu da hamle oynandığı anda yakalar; ama süre tam o hamleden önce biterse (şah henüz piyon
  şahındayken, alış henüz yapılmamışken, hak henüz dururken) onu yalnızca bir ileri bakış ya da
  Domino araması görür.

**Ötesi:** birden fazla hamle süren zorunlu çizgiler (verideki 4.532 satır) kısa bir arama ister:
Domino araması.

## Katmanlar

Kaynak `src/` altında, her katman bir ES modülü. Mateless'in kendisi bunların dördü; gerisi onun
üzerinde durduğu standart altyapı. Her katmanın `import` satırları tahtadan tam olarak ne aldığını
söylüyor.

| dosya | katman | tahtadan ne istiyor |
|---|---|---|
| `src/material.js` | **1. basamak:** malzeme testi | taş kümeleri; hamle üretmiyor |
| `src/lock.js` | **2. basamak:** kilit dedektörü; iki statik test birlikte | taş kümeleri, en passant karesi, birkaç kaydırma; hamle üretmiyor |
| `src/domino.js` | **3. basamak:** Domino araması (6 ply / 100 düğüm) | taş taş, sabit sırada legal hamleler, yerinde yapıp geri alma, "yasal hamle var mı?", pozisyonun birebir kodu |
| `src/ladder.js` | **merdiven:** basamakların ne zaman sorulduğu, tek pozisyon için ispatlar, bir oyunun iki bayrağı (`Flags`) | yarım hamle sayacı ve en passant karesi |
| `src/board.js` | referans tahta: bitboard, magic bitboard, legal hamleler, FEN, Chess960 | — |
| `src/game.js` | referans oyun: sonuç kodları, tekrarlar, 75 hamle, beşli tekrar, `Game` | — |
| `src/index.js` | genel API | |

`tools/build.js` katmanları tek dosyada, `mateless.js`'te (ve `mateless.mjs`'te) birleştiriyor: aynı
kod, satırı satırına; import satırları ve `export` kelimeleri çıkıyor. Rust çevirisi aynı
katmanlardan oluşuyor (`rust/src/board.rs`, `material.rs`, `lock.rs`, `domino.rs`, `ladder.rs`).

## Dosyalar

```
src/                 kaynak: board, material, lock, domino, ladder, game, index (ES modülleri)
mateless.js          motor, tek dosya (src/'den tools/build.js ile; elle düzenlenmez)
mateless.mjs         aynı dosya, ES modülü olarak (o da tools/build.js'ten)
mateless.d.ts        TypeScript tipleri
mateless.wasm        Rust çevirisi, WebAssembly olarak (tools/build-wasm.js); köprüsü mateless-wasm.js
index.html           hakem sayfası (motor gömülü)
chasolver.html       chasolver 3.0.0'ın JavaScript çevirisi (MIT, Miguel Ambrona)
rust/                Rust çevirisi: kütüphane, komut satırı aracı, chasolver karşılaştırmaları;
                     rust/wasm: WebAssembly için ince bir C arayüzü
tools/               build.js, build-wasm.js, embed-engine.js
test/                test takımı (test/README.md)
data/                Lichess verisinin sınıflaması (data/README.md)
docs/                DESIGN.md (nasıl çalışıyor, neden), RESULTS.md (ölçümler)
README.tr.md         bu dosya
LICENSE              MIT
```

## Testler

Ayrıntılar [test/README.md](test/README.md)'de. En sık kullanılanlar, `test/` içinden (chasolver'ın
test dosyaları için `CHASOLVER=<chasolver>/tests`):

```sh
node smoke.js                                    # perft
node perft_cpw.js 5                              # Chess Programming Wiki'nin altı pozisyonu
node classify.js 6 100 1                         # chasolver etiketlerine karşı: FALSE DRAWS 0 olmalı
node game_flags_check.js 1 3000 200              # düşen her bayrak, chasolver'ın tam çözücüsüne karşı
node twosided_check.js <dosyalar>                # iki taraf tek geçişte = taraf taraf, her alanda
node trigger_check.js                            # testsAfter = sayaç kuralı, geri almalar dahil
node build_check.js                              # mateless.js ve .mjs = src/'nin derlemesi, sayfa aynı motoru taşıyor
node page_check.js                               # iki sayfa, başsız Chromium'da
node wasm_check.js                               # mateless.wasm = mateless.js
node types_check.js                              # mateless.d.ts motora karşı (npm i --no-save typescript)
node lock_invariant.js ../data/locked_positions.tsv 50   # değişmez kontrolü, her 50. kilit
```

## Lisans ve teşekkür

- MIT Lisansı, © 2026 Cüneyt İnan ([LICENSE](LICENSE)).
- FideLite.Art golfstack motorundan esinlenildi.
- Lichess verisi ve etiketli test pozisyonları Miguel Ambrona'nın
  [chasolver](https://github.com/miguel-ambrona/chasolver) projesinden. `chasolver.html`
  chasolver'ın MIT lisanslı kodunun çevirisi; lisans metni dosyanın içinde. chasolver'ın kendi
  sitesi: [chasolver.org](https://chasolver.org).
