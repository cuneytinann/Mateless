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

Tek kütüphanede, yan yana iki sürüm var. **Hızlı** sürüm (ilki) Lichess'e önerilen katman:
[`lock/`](lock/) klasöründeki ve scalachess yamasındaki kilit dedektörü ve kısa bir arama. **Tam**
sürüm (ikincisi) daha çok şey gören kurallar ekliyor: önü açık piyon çiftleri, kutulu at, kale ve
vezir, hamle hamle hamlesiz rakip, aramanın ikinci bir kademesi ve istenirse hamle ve tekrar kuralları, hamle sınırına yakınken
saatle sınırlı bir aramayla. O da tam değil; adı hedefini söylüyor. Her kuralı yalnızca kendi
durumu tahtadayken çalışıyor, geri kalan her pozisyon hızlı sürümün kodundan geçiyor
([ikinci sürüm](#ikinci-surum)).

**[Site](https://cuneytinann.github.io/Mateless/)** · [English](README.md) ·
[Tasarım](docs/DESIGN.md) · [Sonuçlar](docs/RESULTS.md) ·
[Lichess için: mateless-scalachess](https://github.com/cuneytinann/mateless-scalachess)
(belgeler İngilizce)

## Bütün yapının bit düzeyinde tespiti

Mateless'in merkezinde bir **kilit dedektörü** var: hiçbir yasal hamle dizisinin açamayacağı
piyon, şah ve fil yapılarını tek bir hamle üretmeden, yaklaşık 90 nanosaniyede tanıyor.

Yapının bütününe bir kerede, bit düzeyinde bakıyor: bir tarafın bütün piyonları tek bir koni, bir
şah tek bir erişim kümesi; 64 bitlik kümeler üzerinde birkaç işlem bütün yapıyı bir sabit noktaya
taşıyor. Bildiğimiz kadarıyla bu, onu türünün en hızlı yöntemi yapıyor: dedektörün arkasındaki
kısa aramayla (26 Kasım 2026'ya kadarki varsayılanıyla 6 ply ve 100 düğüm; şimdi 3 ve 10) Mateless,
aşağıdaki Lichess verisinin **%99,98'ini** bilinen en yakın yöntemden **~17–18 kat hızlı** kapsıyor
(Rust'a karşı Rust).

Alanın referansı [chasolver](https://github.com/miguel-ambrona/chasolver) (Miguel Ambrona, FUN 2022)
tam bir çözücü: Mateless'in denemediği bestelenmiş problemleri de çözüyor. Mateless böyle bir
çözücünün önüne konan hızlı katman; bir oyun sunucusunun içinde her hamlede çalışacak kadar küçük.

## Hız

Kilitli bir pozisyon **yaklaşık 90 nanosaniyede** ispatlanıyor (Rust; pozisyon önbellekteyken
~60 ns). Gerçek bir oyundan, tahtasında at, kale ya da vezir olan bir pozisyonu kilit dedektörü
**~9 ns'de** eliyor. Merdivenin tamamı Lichess süre bitimi başına ortalama **~0,23 µs**; bir
oyunu izlemek, iki tarafın bayrağı için **hamle başına ~0,35 µs**. Hızlar chasolver'ın temmuz
2026'ya kadarki listesinde (201.060 satır, 50.970 kilit) ölçüldü; ağustos–eylül taramasının
satırları sonradan eklendi.

Aşağıdaki tablolar ilk sürümde ölçüldü. İkinci sürüm bir oyunun pozisyonlarında hamle başına
yaklaşık %2 daha pahalı; çoğu, tahtada at, kale ya da vezir varken kutulu taşlara hızlı bir bakış
(Rust'ta ~2 ns, JavaScript'te ~10 ns). chasolver'a karşı oranları gürültü içinde aynı; tam
merdiveni (o zaman: 6 ply ve 100 düğüm, 9 ve 10.000'lik ikinci bir kademe) chasolver'ın 201.060
satırının 201.054'ünü ispatlıyordu, eylüle kadarki 204.060 satırda
satır başına ~0,22 µs'de (Rust; [docs/RESULTS.md](docs/RESULTS.md#the-second-version)). Kasım'da
eklenen dört kural (aşağıda) bunu 201.058'e çıkarıyor. Bedeli kilit testi başına JavaScript'te ~%13,
Rust'ta ~%30 (204.060 satırın iki tarafı: ~40 → ~54 ns); tam merdivende satır başına JavaScript'te ~%4,
Rust'ta ölçülemeyecek kadar az.

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

chasolver 201.060 satırın hepsini, Mateless 201.024'ünü (ikinci sürüm 201.058'ini; tablonun tamamı gibi, 6 ply ve 100 düğümle) ispatlıyor.
Kapsam yalnızca chasolver'ın listesinde sayılıyor: ağustos–eylül taramasının 3.000 satırı, hem
chasolver'ın hem Mateless'in ispatladığı satırlar olarak seçildi. Tarayıcı aynı motoru
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
| **2. kilit dedektörü** | alıştan, piyon hamlesinden, en passant hakkının düşmesinden ya da şahın piyon şahından çıkmasından sonra | piyon, şah ve fil yapısı hiçbir yasal hamle dizisiyle açılamıyor (ilk sürüm: tahtada at, kale ya da vezir varsa hemen düşüyor; ikinci sürüm kutulu olanlara izin veriyor ve önü açık piyon çiftlerini ayırıyor) | ~0,3–0,8 µs |
| **3. Domino araması** | her hamleden sonra | 3 ply ve 10 düğümlük (26 Kasım 2026'ya kadar 6 ve 100) bir helpmate araması mat bulmuyor; her dizi görülmüş bir pozisyonda, statik bir ispatta ya da patta bitiyor | ~1–5 µs |
| **4. hamlesiz rakip, ikinci kademe** (ikinci sürüm) | Domino araması mat bulmadan başarısız olunca (bütçe ya da ufuk) | önce hamle hamle hamlesiz rakip: sıra bayrağı düşende, mat edecek tarafın yalnız şahı ve piyonları var ve bayrağı düşenin her hamlesinden sonra mat edecek tarafın legal hamlesi yok (bitboard'lardan okunuyor; düğüm yok); sonra aynı arama 9 ply ve 5.000 düğümle. Merdiven bu kadar: üçüncü bir kademe (150 ply, 5.000.000 düğüm) hakem sayfasının, oyun sonrası analiz için; hiçbir motorda yok | hamlesiz rakip: bit işi, arama yok; ikinci kademe en çok 5.000 düğüm; arama, hatları bitince biter |

- **İki bayrak da düştüyse** pozisyon ölü (FIDE 5.2.2): oyun berabere biter.
- **Süre bitince ya da bir taraf terk edince** hesap yapılmaz: rakibin bayrağı düşmüşse
  beraberlik (FIDE 6.9, 5.1.2), düşmemişse kayıp.
- İki taraf tek geçişte inceleniyor: kilit dedektörünün taraftan bağımsız kısmı ve iki aramanın
  yürüyüşü ortak.
- Statik testler yalnızca cevaplarını değiştirebilecek bir hamleden sonra soruluyor
  (`testsAfter`). Bunun için bayraklar bir önceki ply'dan iki şey hatırlıyor: en passant karesi
  var mıydı, sıradaki taraf piyon şahında mıydı. Ply atlanırsa ya da hamle geri alınırsa
  pozisyonun kendisi karar veriyor (yarım hamle sayacı en fazla 1 ise iki test de).
- **Varsayılan olarak hiçbir hamle sayacı kuralı ispata katılmıyor** (istenirse ikinci sürüm hesaba katar: `moveRule`, `repetition`, İkinci sürüm bölümü): 50 ve 75 hamle kuralları ve tekrarlar dizileri
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

| sınıf | satır | pay | Lichess bugün berabere veriyor (scalachess 18.1.0) | oyun içinde kilit kontrolü (in-game) | bayrakta kilit kontrolü (a-lock) |
|---|---|---|---|---|---|
| **kilitli pozisyonlar** (kilit dedektörü) | **52.050** | %26,7 | 141 | **52.034** | 52.050 |
| zorunlu çizgiler (Domino araması) | 143.201 | %73,3 | 138.431 | 138.431 | 138.669 |
| ispatlanamayan | 36 | %0,018 | 0 | 0 | 0 |
| **hepsi** | **195.287** | | **138.572** (%71,0) | **190.465** (%97,5) | 190.719 (%97,7) |

Tablo ilk sürümün sınıflaması (veri dosyaları onu tutuyor). İkinci sürüm ispatlanamayan 36
satırın 34'ünü ispatlıyor; 2'si kalıyor ([`data/second_version.tsv`](data/second_version.tsv)).

Lichess bugün zorunlu çizgilerin çoğunu berabere veriyor: scalachess #821 (Ağustos 2026'da
birleşti; veriye göre Lichess'te 6 Eylül'den beri kullanılıyor), lila'nın süre bitince sorduğu
teste bir hamlelik ileri bakış ekledi. Hâlâ kaçırdıkları neredeyse tamamen **kilitli
pozisyonlar**: 56.715 kaçırılan satırın 51.909'u. 7–30 Eylül'de, #821 kullanılırken, 460 oyun yine
böyle süreden kaybedildi; 422'si (%92) kilitti.

Lichess için önerilen kilit yaması
([lichess-org/scalachess#916](https://github.com/lichess-org/scalachess/pull/916); #907'nin
yerini aldı) yalnızca kilit dedektörünü (181 satır Scala) iki yerde soruyor; Standart, Chess960 ve
From Position oyunlarında. **Oyun içinde**
[mateless-scalachess](https://github.com/cuneytinann/mateless-scalachess)'teki `in-game`:
scalachess'in `autoDraw`'unda bir ölü pozisyon kontrolü (FIDE 5.2.2); yarım hamle sayacı 0 ya da 1
iken, yani bir alıştan ya da piyon hamlesinden hemen sonra ve bir hamle sonra, iki taraf için
soruluyor: kilit ancak o anlarda oluşabilir. Oyun kilitlendiği anda berabere bitiyor; yukarıdaki
satırların 52.034'ü süre bitmeden önce biterdi: Lichess'in bugün kazanç saydığı 51.893 (eylüldeki
422 de bunların içinde) ve süre bitince berabere verdiği 141. **Süre bitince ya da bir oyuncu terk
edince** `a-lock`: aynı dedektör bir kez daha, pozisyonda ve #821'in ileri bakışında soruluyor.
Oyun içi kontrolün göremediklerini berabere veriyor: yalnızca bir tarafın kilidi olan 16 satır
(ölü değil: süresi biten taraf hâlâ mat edebilirdi; bu süre bitiminin sorusu, FIDE 6.9) ve kilidin
süre bittikten bir hamle sonra geldiği 238 satır. Toplam: 190.719 satır (%97,7). Yalnızca süre
bitince sorulsaydı ölü bir oyun başka bir yoldan bitene kadar oynanmaya devam ederdi: ağustos ve
eylülde 8.718 berabere oyun, böyle bir kilit oluştuktan sonra ortanca 14 ply daha sürdü. Merdivenin
tamamı, Mateless'in kendisi ya da o repodaki `c-ladder` yaması, 195.251 satırı (%99,98) berabere
veriyor.

Satırların 117.455'inde (%60) son pozisyon zaten ölüydü, iki taraf da mat edemiyordu: FIDE 5.2.2'ye
göre bu oyunlar süre bitmeden önce berabere bitmişti.

Sınıflama [`data/`](data) klasöründe, en yeni oyun en üstte: `timeouts_classified.tsv` (her satır:
oyun kimliği, tarih, sınıf, Lichess bugün, bayrakta `a-lock` ile, ölü pozisyon, `in-game` ile),
`locked_positions.tsv` (52.050 kilitli pozisyon, mat edemeyen tarafla) ve
`lichess_2026-08_09.tsv` (taranan satırlar son pozisyonlarıyla; yanlarında rakip hiçbir zaman
mat edemezken terk edilen 170 oyun: FIDE 5.1.2'ye göre beraberlik, Lichess ise her terki kayıp
sayıyor). İspatlanamayan 36 satırın hepsi chasolver'ın temmuza kadarki listesinden (taranan
satırlar Mateless'in ispatladıkları arasından seçildi). 32'si,
ulaşılabilen pozisyonları arasında pat bulunan kafesler (çoğu köşeye kapanmış bir şah, son piyonu
almak pat getiriyor; 6'sında vezir ya da kale var), 3'ü önü açık bir piyon çifti (bir sütunda bir
beyaz ve bir siyah piyon, aralarında tek boş kare, yapının geri kalanı kilitli), 1'i kendi
piyonlarının arasına kapanmış bir at. Oyundan sonra bir puan iadesinin kapsayacağı şey bunlar ve
platformun kendi kurallarının bıraktıkları: oyun bittikten sonra tam bir çözücü (chasolver) onlara
bakar. Merdivenin tamamıyla bu 195.287 satırda 36 satır; bugünkü Lichess'in üstüne yalnızca kilit
dedektörüyle 4.822 (yalnızca `in-game`) ya da 4.568 (`a-lock` ve ikisini birden yapan #916). İkinci
sürüm 36'nın 34'ünü ispatlıyor: arama kafeslerin 27'sini (ikinci kademesiyle), pat bekçisi 3'ünü
daha, önü açık çift kuralı 3 çifti, kutulu taş kuralı atı. Kalan ikisi de fil kafesi: bKHPqNEw'yi
hakem sayfasının üçüncü kademesi ispatlıyor (150 ply, 5.000.000 düğüm: oyun sonrası analiz),
RwnQJq1k ise arama kuralın sonuna eriştiğinde 75 hamle kuralına düşüyor (oyundaki pozisyonda, saat
11'de, sayfanın üçüncü kademesiyle; kendi başına saat 120'den sonra). (26 Kasım 2026'dan beri
varsayılan olan 3 ply ve 10 düğümle ilk sürüm, chasolver'ın 19 Kasım'daki 204.484 satırlık
listesinin 656'sını bırakıyor, ikincisi 2'sini, aynı ikisini, 75 hamle kuralıyla da kuralsız da;
sayfanın üçüncü kademesi ve 75 hamle kuralıyla hiçbirini.) Yani oyun içinde tam sürüm de, çok
nadiren, mat edilemeyen bir pozisyonu ispatsız bırakabilir; oyun sonrası analiz, üçüncü kademeyle
ve gerekirse daha büyük bir bütçeyle, onu yakalar.

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
- **İkinci sürümün kuralları** aynı kontrollerden geçti: chasolver'ın etiketlerine karşı yanlış
  beraberlik yok; JS, Rust ve WebAssembly 538.094 pozisyonda ve 3.000 oyunda, düğüm sayılarına
  kadar aynı cevabı veriyor; değişmez kontrolü 5.081 kutulu taş ve 13.085 önü açık çift
  sertifikasında ihlal bulmuyor (61 milyon pozisyon, 15'i dışında hepsi sonuna kadar dolaşıldı);
  chasolver'ın tam analizi her yeni kilide "kazanılamaz" diyor (5.081 kutulu kilit ve 20.000 fuzz
  sertifikası; önü açık çiftin 130.858 yeni kilidinde kendi deneyinde ulaşılabilen her pozisyon
  dolaşıldı, chasolver örneklemlerde soruldu) ve hamle hamle oynanan 7.000 oyunda düşen hiçbir
  bayrakta mat bulmuyor (`test/second_version_check.js` 36 satırı ölçülen ispatlarına bağlıyor).

## Kullanım

**Sayfa.** Bütün site tek dosyada, `index.html`'de: tarayıcıda açılır, kurulum gerekmez. Sitenin ön
sayfası odur, [cuneytinann.github.io/Mateless](https://cuneytinann.github.io/Mateless/); İndir
bağlantısı aynı dosyayı kaydeder, o da internetsiz çalışır (yalnızca yazı tipleri internetten
gelir). Varsayılan dil İngilizce; Türkçe seçilebilir. Beş sekme:
- **Hakem**: bir FEN, CSV ya da TXT pozisyon dosyaları ya da PGN oyunları. Her hüküm bir
  skor ve gerekçesiyle (yetersiz materyal, kilitli pozisyon, Domino etkisi, mat bulundu, ispat yok)
  ve ona götüren basamaklarla gösterilir; ölü pozisyonlar işaretlenir; sonuçlar CSV olarak
  indirilir. chasolver'ın, berabere bitmesi gerekirken süreden kaybedilmiş Lichess oyunları
  listeleri ([chasolver.org/unfair-games](https://chasolver.org/unfair-games)) doğrudan bırakılabilir.
- **Kilit dedektörü**: ikinci basamak, en basitten başlayarak. Lichess kilitlerinde ne var, at,
  kale, vezir ve ikiz filler neden dışarıda; sonra bitboard'larla piyonlar ve şahlar (alış varsa
  kilit yok; koniler; duvarlar, sabit piyonlar, şah erişimleri ve alım karelerinin sabit noktası;
  tek duvar, iki yarı; donmuş şah); sonra filler (temas, mat ağı), geçerken alma ve mat eden
  hamle; her varsayım ve neden güvenli olduğuyla. Bir gezgin, her FEN için geçişleri adım adım
  gösteriyor; tahtaları tarayıcıda hesaplanıyor ve çizildikçe mateless.js ile denetleniyor.
  Dedektörün kendisi, 20 dilde (ilk sürüm, ikincisi de `second/` klasöründe), oradan
  `mateless-lock.zip` olarak iniyor.
- **Kurallar**: FIDE 5.2.2, 6.9 ve 5.1.2; kitap ne diyor, bir algoritma onu nasıl okuyabilir.
- **Lichess taraması**: Lichess'in aylık veritabanlarından birini (`.pgn.zst`) bırak, tarayıcıda,
  bütün çekirdeklerle, dosya açılmadan taransın: kazananın hiç mat edemeyeceği hâlde kazançla
  biten oyunlar ve pozisyon öldükten sonra oynanmaya devam eden beraberlikler, Mateless ve
  chasolver için, CSV dosyaları olarak.
- **chasolver**: Miguel Ambrona'nın chasolver 3.0.0'ının JavaScript çevirisi (resmi değil; MIT),
  ana dalındaki pat süzgeci düzeltmesiyle (11 Kasım 2026) ve aynı süzgece bizim, henüz chasolver'da
  olmayan bir düzeltmemizle: rakip şahın alabileceği taşlar artık onun duvarı sayılmıyor. Bu,
  bildirdiğimiz 57 Lichess oyununda ana dalın hâlâ verdiği 44 yanlış "kazanamaz" hükmünü bitiriyor.
  Tam çözücü; kazanılabilir her pozisyon için bir mat hattı gösterir. Aynı düzeltmeli Rust
  sürümüyle her satırda aynı cevabı verdi: hızlı kontrol 342.559 girdide, tam analiz, mat hatları
  dahil, 138.075 girdide. Hakemdeki "chasolver'a sor" düğmesi pozisyonu ona aktarır.

Sayfa `site/`'tan kuruluyor (her sekmeye bir klasör, bkz. [site/README.md](site/README.md)) ve
motoru gömülü taşıyor; `src/` ya da `site/` değişince:

```sh
node tools/build.js && node tools/build-site.js
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

// Platformun kendi kuralları: oyun ne zaman kendiliğinden biter (ispatlar da onunla), ne zaman
// beraberlik iddia edilebilir (hiçbir ispat iddiaya dayanmaz), merdivenin ne kadarı çalışır.
const g2 = new E.Game(position, { moveRule: 100, repetition: 3, claimMoves: 0, claimRepetition: 0, rungs: 2 });
g2.claimable() & E.Claim.THREEFOLD;                 // oyuncunun şimdi yapabileceği bir iddia (burada yok, kendiliğinden biter)
new E.Game(position, { moveRule: 150, repetition: 5, dominoAtEnd: true });   // aramalar yalnızca süre bitince ya da terkte

// Kendi oyun nesnesi olan bir platform yalnızca bayrakları tutar: yeni pozisyon ve ply'ı.
const flags = new E.Flags();
flags.update(position, 0);                          // ilk pozisyon (ply 0): iki taraf da kilitli
flags.neverMates(E.WHITE) && flags.neverMates(E.BLACK);   // true: ölü pozisyon
```

`mateless.js` hem klasik `<script>` olarak (`globalThis.Mateless`) hem Node modülü olarak çalışıyor;
`mateless.mjs` aynı tek dosyanın ES modülü hali (`import { fromFen, proveBoth } from
'./mateless.mjs'` ya da `import Mateless from './mateless.mjs'`). Kaynak modüller
(`./src/index.js`) aynı cevapları veriyor ama V8'de ~%10–30 yavaş.

**WebAssembly.** Rust çevirisi `mateless.wasm` olarak derlendi (269 KB, gzip ile 87 KB);
bağımlılıksız köprüsü `mateless-wasm.js`. Merdivenin tamamını (statik testler, Domino, iki ispat,
bir oyunun bayrakları, perft), bütün bir oyunu (`W.Game`: aynı seçenekler, sonuçlar ve iddialar,
legal hamleler, FEN; `test/game_check.js`) ve istenirse oyunun kendiliğinden bittiği kuralları veriyor,
`mateless.js` ile düğüm sayısına kadar aynı cevaplarla. İspatlar JS'ten ~2,5–4 kat, bir oyunun
bayrakları ply başına ~3,2 kat, kurallarla (saat araması) ~2–3 kat hızlı; yerel Rust bundan da
~1,4–1,9 kat hızlı. Yeniden derlemek için `node tools/build-wasm.js`.

```js
const W = require('./mateless-wasm.js').instantiate(require('fs').readFileSync('mateless.wasm'));   // tarayıcıda: await MatelessWasm.load('mateless.wasm')
W.proveBoth('8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3K4 b - - 47 92');   // [Beyaz için, Siyah için], mateless.js'tekiyle aynı
const flags = new W.Flags();                                // bir oyunun bayrakları
flags.update(fen, ply);                                     // her hamleden sonra, FEN ya da W.fromFen(fen).position ile
// kurallarla, mateless.js'in seçenekleri; history: mateless.js'ten game.repetitionHistory(),
// ya da son alıştan veya piyon hamlesinden beri bundan önceki pozisyonların FEN'leri
W.proveCannotBeMated(fen, W.BLACK, { moveRule: 100, repetition: 3, history });
const ruled = new W.Flags({ moveRule: 150, repetition: 5 });
ruled.update(fen, ply, history);
```

**Rust** ([rust/README.md](rust/README.md)):

```rust
let pos = mateless::from_fen("8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3K4 b - - 47 92").unwrap();
let mut search = mateless::Domino::new();
let proof = mateless::prove_cannot_be_mated(&mut search, &pos, mateless::BLACK, mateless::DOMINO_PLY, mateless::DOMINO_BUDGET);
assert!(proof.proven && proof.static_proof);    // kilit dedektörü: Beyaz hiçbir zaman mat edemez

// Platformun kendi kurallarıyla bir oyun (GameOptions::DEFAULT: FIDE'ninkiler, tüm merdiven).
let mut game = mateless::Game::new(&pos, mateless::GameOptions::DEFAULT).unwrap();
let result = game.flag_verdict(mateless::BLACK, false);   // 11: süreden beraberlik
```

**TypeScript.** Tipler motorun yanındaki `mateless.d.ts`'te; TypeScript onları kendiliğinden buluyor:

```ts
import Mateless = require('./mateless');      // ya da: import { fromFen, proveBoth } from './mateless';
const r = Mateless.fromFen('8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3K4 b - - 47 92');
if (r.error === undefined) Mateless.proveCannotBeMated(r.position, Mateless.BLACK);   // Proof
```

**FEN okumak.** `fromFen` (`src/fen.js`), dışarıdan gelen her konumun girdiği dış katman; merdiven
onu hiç çağırmaz, onun kabul ettiği bir konumdan yasal hamlelerle ulaşılan konuma ikinci kez
bakmak gerekmez. `{ position, halfmoveGiven, fullmove, fixed, fen }` ya da `{ error, detail }`
döndürür ve hiçbir satranç ya da Chess960 oyununun ulaşamayacağı konumu bilinen gerekli koşullarla
reddeder:

| hata | konum |
|---|---|
| `syntax`, `kings`, `pawnrank` | FEN değil; her tarafta tek şah yok; ilk ya da son yatayda piyon var |
| `oppcheck` | sırası olmayan taraf şah altında (yan yana iki şah da bu sayılır) |
| `pawns`, `pieces` | bir tarafta 8'den fazla piyon ya da 16'dan fazla taş |
| `promo` | başlangıç takımından (bir vezir, iki kale, iki at, her renkte bir fil: fil rengini hiç değiştirmez) eksik piyonların terfiyle olabileceğinden fazla taş |
| `captures` | kendi sütununda olmayan piyonlar: her biri ayrı bir sütundan gelmek için karşı tarafın eksik taşından fazla alma istiyor |
| `checks` | şahları karşı tarafın hiçbir son hamlesi vermiyor: geri alınınca her hamle (hamle, alma, terfi, geçerken alma, rok) sırası gelen tarafı şah altında bırakıyor ya da tahtada olmayan bir taş istiyor (alınan taş ancak tarafının 16'dan az taşı varsa geri gelir, terfi ancak hamle yapanın 8'den az piyonu varsa geri alınır). Yani üçlü şah, tek hamlenin veremeyeceği her çifte şah (iki at, şahtan geçen tek hat üzerinde iki taş, hamle eden taşın hiç durmadığı bir hattan açılan şah, alarak terfi olmadan iki kale), başlangıç yatayından şah çeken piyon, hiçbir yerden gelemeyen taş |

Tek bir okunuşu olan şey reddedilmek yerine düzeltilir ve `fixed`'de adı geçer: tahtanın izin
vermediği rok hakları (`castling`); hiçbir iki kare ilerleyişin bırakmadığı geçerken alma karesi:
yanlış yatay, boş olmayan kareler, 0'dan büyük yarım hamle sayacı ya da ilerleyişin veremeyeceği bir
şah (`en passant`); şahı ancak bir alma ya da piyon hamlesi vermiş olabilecekken 0'dan büyük yarım
hamle sayacı (`halfmove`, 0 yapılır); yarım hamle sayacının gerektirdiğinden küçük hamle numarası
(`fullmove`). `fen`, bunlar düzeltilmiş FEN. Bunlar yalnızca gerekli koşullar: hepsinden geçen bir
konuma da ulaşılamıyor olabilir (bu daha geriye giden bir retro analiz ister).
`fromFen(fen, { strict: false })` yalnızca `syntax`, `kings`, `pawnrank` ve `oppcheck`'i tutar;
bestelenmiş konumlar ve test kümeleri için.

Hiçbir yasal konum reddedilmez ya da değişmez: python-chess'in rastgele oyunlarının, standart ve
Chess960, şahı bol, sundukları her çifte şah, rok, geçerken alma ve terfi şahıyla, geçerken alma
alanının iki biçiminde, her konumu (`test/fen_check.js`; uzun koşularda 2,17 milyon FEN); ve
python-chess'in geçersiz bulduğu her rastgele tahta reddedilir. Rust portu (`from_fen`,
`from_fen_with`) ve `mateless.wasm` (`W.fromFen(fen, { strict })`) 2,27 milyon FEN'de aynı okur.
Sayfada konumlar kutusu, kutudan çıkılınca FEN'i motorun düzelttiği gibi yazar.

**scalachess (Lichess)** için ayrı bir repo var:
[mateless-scalachess](https://github.com/cuneytinann/mateless-scalachess). scalachess 18.0.1'e yama
setleri: `autoDraw`'da ölü pozisyon kontrolü olarak yalnızca kilit dedektörü (`in-game`), aynı
dedektör süre bitince (`a-lock`) ve merdivenin tamamı (`c-ladder`, başvuru için). Lichess için
önerilen #916, `in-game` ile `a-lock`'un ikisi birden.

## Yalnızca kilit dedektörünü almak

Merdivenin geri kalanı olmadan yalnızca kilit dedektörünü almak isteyen bir platform için.

**En sade yol:** [`mateless-lock.zip`](mateless-lock.zip) ([`lock/`](lock/) klasörü) dedektörün
kendisini en sade hâliyle 20 dilde taşıyor: C, C++, C#, Crystal, Go, Haskell, Java, JavaScript,
Kotlin, Lua, Nim, OCaml, Pascal, PHP, Python, Ruby, Rust, Scala, TypeScript, Zig. Her biri kendi
dilinin standart kütüphanesi üzerinde iki yüz kadar satır ve hepsi aynı 36.406 test pozisyonunda
aynı cevapları veriyor ([lock/README.tr.md](lock/README.tr.md)). İçindeki `second/` klasörü
ikinci sürümü aynı biçimde taşıyor: aynı 20 dilin her birinde 430 ile 650 satır arası, 60.471 test
pozisyonunda aynı cevaplar ([lock/second/README.tr.md](lock/second/README.tr.md)). Aşağıdaki tablo
Mateless'in içindeki hızlı sürümler.

**Ne istiyor:** piyonların, şahların ve fillerin (renkleriyle) bitboard'ları, tahtada at, kale ya
da vezir olup olmadığı ve en passant karesi (yalnızca o kareye yasal bir alış varsa). Hamle
üretmiyor, aramıyor.

| dil | fonksiyon |
|---|---|
| JS | `lockCannotMate(pos, flagged)` (`src/lock.js`) |
| WebAssembly | `lockCannotMate(fen ya da Position, flagged)` (`mateless-wasm.js`) |
| Rust | `lock_test(&pos, flagged)` (`rust/src/lock.rs`) |
| Scala (scalachess) | `chess.mateless.Lock.cannotBeMated(position, flagged)` (mateless-scalachess: `in-game`, `a-lock`) |

**Maliyeti** (çağrı başına):

| | Rust | JS | Scala (scalachess) |
|---|---|---|---|
| tahtada at, kale ya da vezir var (oyunun çoğu): hemen çıkıyor | ~9 ns | | ~30–35 ns |
| kilitli pozisyon (sabit noktanın tamamı) | ~105 ns | ~0,3–0,8 µs | ~150–190 ns |

**Tek başına neyi görür:** pozisyonun kendisinde duran bir kilidi: yukarıdaki 195.287 Lichess
satırının 52.050'si, Lichess'in bugün kaçırdığı 51.909'u dahil.

**Neyi görmez:** bir hamle ötedeki kilidi.
1. **Piyon şahından çıkış.** Piyon şahındaki şah, bir piyonun saldırdığı bir karede duruyor ve
   erişimi oradan, başka türlü giremeyeceği karelere de yayılıyor; oradan çıkınca kilit
   tamamlanabiliyor. `8/8/1k6/p2p2p1/PK1P2Pp/7P/8/8 w`: Beyaz'ın her şah hamlesi kilide giriyor.
2. **Zorunlu alış.** Son atı, kaleyi ya da veziri almak tek hamleyse, alıştan sonra bir kilit (ya da
   çıplak malzeme) geliyor. `8/8/6R1/1p1p1k2/1P1Pp3/4P1p1/6P1/6K1 b`: Şxg6 tek hamle.
3. **En passant hakkının düşmesi.** Hak dururken dedektör başarısız; sonraki herhangi bir hamle hakkı
   düşürüyor.

**Sormanın üç yolu:**
- **Her hamleden sonra ölü pozisyon kontrolü** (`in-game`, #916'nın ilk yarısı,
  scalachess'in `autoDraw`'unda): yarım hamle sayacı 0 ya da 1 iken kilidi iki taraf için sor; iki
  taraf da mat edilemiyorsa pozisyon ölüdür (FIDE 5.2.2) ve oyun hemen biter. Kilit ancak bir
  alıştan ya da piyon hamlesinden sonra, hemen ya da bir hamle sonra oluşur: piyon şahı da en
  passant hakkı da az önce oynanan piyon hamlesinden gelir, bir sonraki ply onların bitişini
  kapsar. Ne zaman sorulacağını yalnızca sayaç söyler; hiçbir şey hatırlanmaz. Yukarıdaki üç durum
  da hamle oynandığı anda yakalanır. Yalnızca bir tarafın kilidini görmez (o, süre bitince sorulan
  sorudur, FIDE 6.9); süre bittikten sonraki hamlenin tamamlayacağı kilidi de görmez. Lichess
  verisinde: 190.465 satır (%97,5); 52.034'ü süre bitmeden önce biterdi, bunların 51.893'ü bugün
  süre kaybı.
  ```
  kilitle ölü  ⇔  yarım hamle sayacı ≤ 1  ve  kilit(pozisyon, Beyaz)  ve  kilit(pozisyon, Siyah)
  ```
- **Süre bitince, bir hamlelik ileri bakışla** (`a-lock`, #916'nın ikinci yarısı; scalachess #821
  süresi biten tarafın her hamlesine bakıyor): kilidi pozisyonda ve her çocuk pozisyonda sor. Üç
  durum da kendiliğinden gelir; çocuk pozisyonda en passant hakkı kalmamıştır. Lichess verisinde
  çocuk pozisyonlar 238 satır ekledi: 237'si piyon şahından çıkış, 1'i zorunlu kale alışı. Ama ölü
  bir oyun, süre bitene ya da başka bir yoldan bitene kadar sürer.
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
| `src/domino.js` | **3. basamak:** Domino araması (3 ply / 10 düğüm) | taş taş, sabit sırada legal hamleler, yerinde yapıp geri alma, "yasal hamle var mı?", pozisyonun birebir kodu |
| `src/ladder.js` | **merdiven:** basamakların ne zaman sorulduğu, hamle hamle hamlesiz rakip ve ikinci kademe (4. basamak), tek pozisyon için ispatlar, bir oyunun iki bayrağı (`Flags`) | yarım hamle sayacı ve en passant karesi |
| `src/board.js` | referans tahta: bitboard, magic bitboard, legal hamleler, FEN, Chess960 | — |
| `src/fen.js` | **dış katman:** FEN'i bir oyunun ulaşabileceği konum olarak okumak (`fromFen`): neyi düzelttiği, neyi reddettiği | tahtanın FEN okuyucusu ve saldırı testi |
| `src/game.js` | referans oyun: sonuç kodları, tekrarlar, 75 hamle, beşli tekrar, `Game` | — |
| `src/index.js` | genel API | |

`tools/build.js` katmanları tek dosyada, `mateless.js`'te (ve `mateless.mjs`'te) birleştiriyor: aynı
kod, satırı satırına; import satırları ve `export` kelimeleri çıkıyor. Rust çevirisi aynı
katmanlardan oluşuyor (`rust/src/board.rs`, `material.rs`, `lock.rs`, `domino.rs`, `ladder.rs`).

## Dosyalar

```
src/                 kaynak: board, fen, material, lock, domino, ladder, game, index (ES modülleri)
mateless.js          motor, tek dosya (src/'den tools/build.js ile; elle düzenlenmez)
mateless.mjs         aynı dosya, ES modülü olarak (o da tools/build.js'ten)
mateless.d.ts        TypeScript tipleri
mateless.wasm        Rust çevirisi, WebAssembly olarak (tools/build-wasm.js); köprüsü mateless-wasm.js
index.html           bütün site tek sayfada: hakem, kilit dedektörü, kurallar, Lichess taraması, chasolver
lock/                kilit dedektörünün kendisi, en sade hâliyle, 20 dilde, ve hepsini deneyen
                     pozisyonlar (lock/README.tr.md); lock/second/: ikinci sürüm, aynı biçimde
                     (lock/second/README.tr.md)
mateless-lock.zip    lock/ tek bir indirme olarak (tools/build-lock-zip.js)
site/                kaynakları, her sekmeye bir klasör; tools/build-site.js birleştiriyor (site/README.md)
rust/                Rust çevirisi: kütüphane, komut satırı aracı, chasolver karşılaştırmaları;
                     rust/wasm: WebAssembly için ince bir C arayüzü
tools/               build.js, build-wasm.js, build-site.js, build-lock-zip.js, lock-positions.js
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
python3 perft_python.py | node perft960.js -     # Chess960 hamleleri = python-chess'inkiler (her başlangıç, ~780.000 pozisyon)
python3 fen_python.py | node fen_check.js -      # fromFen: python-chess'in yasal oyunları olduğu gibi okunur, geçersiz tahtaları reddedilir
node classify.js 6 100 1                         # chasolver etiketlerine karşı: FALSE DRAWS 0 olmalı
node game_flags_check.js 1 3000 200              # düşen her bayrak, chasolver'ın tam çözücüsüne karşı
node twosided_check.js <dosyalar>                # iki taraf tek geçişte = taraf taraf, her alanda
node trigger_check.js                            # testsAfter = sayaç kuralı, geri almalar dahil
node build_check.js                              # mateless.js ve .mjs = src/'nin derlemesi, sayfa aynı motoru taşıyor,
                                                 # lock/positions.tsv, lock/second/positions.tsv ve mateless-lock.zip güncel
(cd ../lock && sh test-all.sh)                   # kilit dedektörünün kendisi, her dilde, lock/positions.tsv üzerinde
(cd ../lock/second && sh test-all.sh)            # ikinci sürümü, her dilde, lock/second/positions.tsv üzerinde
node page_check.js                               # sayfa, her sekmesiyle, başsız Chromium'da
node wasm_check.js                               # mateless.wasm = mateless.js, kurallarla da
node types_check.js                              # mateless.d.ts motora karşı (npm i --no-save typescript)
node lock_invariant.js ../data/locked_positions.tsv 50   # değişmez kontrolü, her 50. kilit
node second_version_check.js                     # ikinci sürümün kuralları: 36 satır, her kuralın pozisyonları
node chess960_boxed_check.js                     # rok kutulu bir kaleyi hiç oynatmıyor (Chess960'ın her dizilişi; şahının yanındaki kale)
```

Kasım kuralları ve ikiz filler Rust ve WebAssembly derlemelerinde de var: `rust_compare.js`,
`wasm_check.js` ve `trigger_check.js` (`mateless.wasm` ile) hiç fark bulmuyor. Hamle kuralları ve
saat araması da öyle: `rust_compare.js rules` ve `games <dosya> <kural> <tekrar>` ile
`wasm_check.js`'in kurallı pozisyonları ve oyunları da fark bulmuyor.

<a id="ikinci-surum"></a>

## İkinci sürüm

Hızlı sürüm (ilki) bir oyun sunucusu için yapılan katman: sağlam, küçük ve her hamleden sonra
çalışmak için yapıldı; chasolver'ın 19 Kasım listesinin %99,68'ini ispatlıyor (aşağıdaki Lichess
verisinin %99,98'ini, 26 Kasım 2026'ya kadarki varsayılanı 6 ply ve 100 düğümle). Tam sürüm (ikincisi) aynı
kütüphanede onun yanında duruyor. O da tam değil ve öyle olduğunu söylemiyor: "tam" hedefinin adı,
yeni kurallar eklendikçe büyümeye devam ediyor. Pratikte en çok meraklıları ve araştırmayı
ilgilendiriyor; bu yüzden aceleye getirilmiyor: her kural yalnızca bilindiğinde ve ölçüldüğünde
giriyor ve yalnızca kendi durumu tahtadayken çalışıyor.

| kural | yalnızca şu zaman çalışıyor | ispatladığı (ilk sürümün ispatlayamadığı 36 satırdan) | başka yerdeki bedeli |
|---|---|---|---|
| **önü açık piyon çiftleri**: bir sütunda aralarında tek kare olan bir beyaz ve bir siyah piyon, geri kalan kilitli; ulaşılabilen pozisyonlar çiftin piyonlarının ne yaptığına göre üç aileye ayrılıyor (hiçbiri oynamadı, beyaz boşluğa girdi, siyah girdi), her biri kendi duvarları olan sıradan bir seviye, en çok 3 çift | piyonlarda böyle bir çift var (iki kaydırma söylüyor) | 3 (ve ağustos–eylülün 5 beraberliğinde ölümü gerçekleştiği ply'da görüyor) | ölçülebilir değil |
| **kutulu at, kale ve vezir**: adım karelerinin hepsinde kendi sabit piyonu ya da kutulu taşı olan bir taş hiç oynamıyor ve yalnızca kendi taşlarının karelerine saldırıyor; tahtada kalabiliyor (golf motorunun kuralı, geçmişten); şahı hiçbir zaman duvar sayılmıyor, bu yüzden rok, Chess960'ınki de, kutulu bir kaleyi hiç oynatmıyor (`test/chess960_boxed_check.js`). Şahının yanındaki bir kale kutulu görünüp yine de rok yapabilir: `8/8/8/4k3/p1p5/P1Pp1p1p/3PpP1P/2B1B1KR w - - 0 1` ölü, rok hakkıyla (`w K`, Chess960) 4 hamlede mat var (1.O-O exf1=N 2.Bb2 Ne3 3.dxe3 d2 4.Kh1 dxe1=Q#); hiçbir test onu ispatlamıyor, aynı kontrol de bunu koruyor | tahtada at, kale ya da vezir var; her kale ve vezirin yanındaki karelere bakıştan sonra (oyun pozisyonlarının %96'sı orada biter) | 1 (hPiwD75i) ve chasolver'ın test pozisyonlarındaki 84 bestelenmiş kilit | böyle bir taş varken kilit testi başına ~2 ns (Rust) / ~10 ns (JS) |
| **Domino aramasından sonra hamle hamle hamlesiz rakip ve ikinci bir kademe**: sıra bayrağı düşende ve mat edecek tarafın yalnız şahı ve piyonları var; bayrağı düşenin bitboard'larda yapılan her hamlesinden sonra mat edecek tarafın legal hamlesi yok (bayrağı düşene karşı açmaz olamaz; mat edecek tarafın piyonları açmazları ve şahlarıyla deneniyor). Sonra arama yeniden, 9 ply ve 5.000 düğümle | arama mat bulmadan başarısız oldu (bütçe ya da ufuk); hamlesiz rakip yalnızca sıra bayrağı düşendeyken, mat edecek tarafta şah ve piyonlar kalmışken ve bayrağı düşenin rok hakkı yokken | 27 (ikinci kademe); 19 Kasım listesinde tam sürümün ilk aramasının matsız bıraktığı 645 satırın 345'ini hamlesiz rakip, kalan 300'ün 2'si (bKHPqNEw ve RwnQJq1k) dışında hepsini ikinci kademe | bir oyunun başarısız aramaları 9 ply'a kadar gider: JavaScript'te hamle başına ~6 µs, iki taraf; hamlesiz rakip bit işi |
| **pat bekçisi**: rakip şahın alabileceği bir piyon, alınması sahibini her durumda pat ediyorsa duvar kalıyor (sahibinin şahı nerede durursa dursun piyonu koruyor ya da adım atacak karesi kalmıyor; sahibinin başka oynayan taşı yok; alış bir filin şahını açmıyor) | döngü, filsiz bir tarafın alınabilir sabit piyonuna rastladığında | 3 (chikSuUd, f6c1lu7R, FKr42ZRT) | |
| **piyon şahı tohumu**: piyon şahındaki bir şahın erişimi kendi karesinden değil, şimdi adım atabileceği karelerden başlıyor; kendi karesine sabit piyon saldırmaya devam ediyor | sırası gelen taraf piyon şahında (tahtada fil yok) | | |
| **hamlesiz rakip**: sıra bayrağı düşen tarafta ve ne oynarsa oynasın mat edecek tarafın yasal hamlesi kalmıyor (oyun onun sırasında bitiyor); bitboard'dan okunuyor, hamle yapılmıyor | şah ve piyonlar, sıra bayrağı düşende, kilit bir şey bulmadı | | |
| **zorunlu adım**: piyon şahındaki, tek yasal hamlesi bir şah adımı olan şah: adımdan sonraki pozisyonun kilidi | piyon şahı tohumundaki gibi, yalnız şah ve piyonla | | |
| **ikiz filler**: bir tarafın aynı renkte iki ya da daha fazla fili (yalnızca terfiyle olur) dedektörü artık düşürmüyor; mat ağı, bayrağı düşen tarafın ikizlerinin iki kaçışı birden tutabileceği şah karelerinde ikinci kaçış kuralını (şahın dikeyde ve yatayda birer boş komşusu, ikisi aynı renkte) saymıyor | bir tarafın ikiz fili var | Lichess verisinde yok; chasolver'ın etiketli pozisyonlarında 227 cevap daha (899'unda ikiz var) | |

Kodda: `lockTest` ikinci sürümün kurallarını uygun olduğu yerde çalıştırıyor;
`_internal.coreLockTest` ilk sürümün dedektörü tek başına (`lock/`'taki, scalachess yamasındaki ve
kilit sekmesinin çizdiği); `proveCannotBeMated(pos, side, { deepBudget: 0 })` ikinci kademeyi
dışarıda bırakıyor (hamlesiz rakip yine çalışıyor), `_internal.stuckEvery(pos, side)` hamlesiz rakip
kuralının kendisi. Bir ispat hangisinin çalıştığını söylüyor: `deep` (ikinci kademe) ve `stuck`.
Üçüncü kademe hiçbir motorda yok: hakem sayfası, kutusu işaretliyse, mat bulmadan başarısız olan
bir merdivenden sonra bir çağrı daha yapıyor, `proveCannotBeMated(pos, side, { maxPly: 150, budget:
5000000, deepBudget: 0 })`, aynı kurallarla.

**Hamle kuralları, istenirse.** Oyun, iki taraf da alış ve piyon hamlesi olmadan 75'er hamle
yapınca (FIDE 9.6.2) ve bir pozisyon beşinci kez gelince (9.6.1) kendiliğinden berabere biter; bazı platformlarda 50
hamlede ya da üçlü tekrarda. Ancak sonra gelebilecek bir mat hiç gelmez. `moveRule: 150` ya da `100` ve `repetition: 5`
ya da `3` ile (tekrarlar için oyunun geçmişiyle: `history: game.repetitionHistory()`) `proveCannotBeMated`,
`proveBoth`, `isDeadPosition`, `flagVerdict`, `Flags` ve `Game` bunu hesaba katıyor:
- arama hattı, yarım hamle sayacı sınıra ulaşmış ve legal hamlesi olan bir pozisyonda berabere biter (o hamlede gelen
  mat yine sayılır); oyunun kökten önce N − 1 kez gördüğü bir pozisyonda da;
- kurallı arama yalnızca kuralsız aramalar başarısız olunca ve bir kuralın bir hattı bitirebildiği yerde koşar: sayaç
  hamle sınırına 40 yarım hamle kadar yakınsa (`REGION_REACH`: iki taraf için 20'şer hamle; aramanın ply'ı daha çoksa
  o kadar) ya da geçmişte N − 1 kez görülmüş bir pozisyon varsa. Yani kuralsız her ispat aynı düğümlerle duruyor;
  kurallar kapalıyken (varsayılan) cevaplar düğüm düğüm öncekiyle aynı;
- hamle sınırına yakınken bu, **saat araması** (`src/clock.js`): ply tavanıyla değil saatin kendisiyle kapanan bir arama.
  Alış ve piyon hamlesi olmadan varılan pozisyonlarda (orada piyonlar yerinden kıpırdamaz), saatin bir hattı
  götürebildiği yere kadar yürür; bir pozisyonda mata ya da bir çıkışa (saati sıfırlayan bir alış ya da piyon hamlesi)
  kalan yarım hamlelerin alt sınırı kalan yarım hamleleri aşınca orayı keser. Mat için: savunan şahın zamanında
  varabileceği her kare için, mat edecek tarafın orada şah çekip kaçışları kapatacak en az hamlesi (her taş tek bir
  kareden tutar, engel yalnızca piyonlar). Çıkış için: bir piyon hamlesine, bir taşın bir piyona varıp onu almasına ya
  da bir taşla buluşup onu almasına kalan yarım hamleler; ardından mat edecek tarafın mat malzemesi kalmayan alışlar
  sayılmaz. Bir çıkışı kuralsız aramalar, çağıranın sınırlarıyla yargılar: tarafın ondan sonra hiç mat edilemeyeceğini
  ispatlayamazlarsa cevap "mat edebilir". Bütçesi en az 200.000 düğüm (`DOMINO_RULE_BUDGET`), çıkışların aramaları
  dahil. Yalnızca bir tekrar pozisyonu varsa Domino araması onunla koşar, ilk kademenin sınırlarıyla (kuralsız izin
  verildiyse ikincisininkiyle);
- kurallı bir `Game` kurallarda biter: 75 hamle ve beşli tekrar kodlarını koruyor (4, 5); 50 hamle 13, üçlü tekrar 14.

Rust'ta da aynısı var (`Rules { move_rule, repetition, history }` ile `prove_cannot_be_mated_rules`,
`prove_both_rules`, `is_dead_position_rules`, `Flags::with_rules`; `rust/src/clock.rs`), WebAssembly'de de
(`mateless-wasm.js` üzerinden yukarıdaki seçenekler); cevaplar ve düğüm sayıları aynı: sayacı bir kurala yakın
20.972 pozisyonda ve dört ayarda (150/5, 100/3, 100, 3) 1.200 oyunda üç motor aynı satırları yazıyor.

Sağlam, ama eksiksizliği yalnızca bu sınırlar içinde. Kurallı bir ispat o kurallarda biten bir oyun için geçerli
(beşlininki üçlüde, 75 hamleninki 50'de de; tersi değil). Yine de bir ispatı kaçırabilir: sayaç sınıra erişiminden
uzaksa, bir çıkıştan sonraki pozisyon kuralsız aramaların ispatlayabildiğinden fazlasını istiyorsa ya da ispat daha
çok düğüm istiyorsa cevap "mat edebilir" kalır, güvenli tarafta. Şah ve kaleye karşı şah (`7k/8/8/8/8/8/8/K5R1 w`, en
kısa yardımlı mat 11 yarım hamle), 50 hamle kuralı: sayaç 89'dayken Beyaz zamanında mat edebilir, 90'da edemez;
varsayılan sınırlarla cevap her sayaçta doğru, 90'dan itibaren 6 düğümde (ondan önceki, kurallı Domino araması 90'da
yanılıyordu, kural 10 yarım hamle uzakta, 9'unun ötesindeydi; 91'de 331.592 düğüm istiyordu). Üç ile beş taşlı
oyun sonlarının (KQK, KRK, KBBK, KBNK, KRRK, KRKB, KRKN, KQKN, KQKR, KBNKN, iki taraftan biri mat ediyor) 12.962
durumunda, her biri kural uzaklığının (bir mata ya da chasolver'ın tam analizinin kazanılabilir dediği bir pozisyona
götüren bir alışa ya da piyon hamlesine en az yarım hamle; böyle bir hamle olmadan varılan her pozisyonun kesin
aramasından) çevresinde bir sayaçla bir pozisyon ve bir kural, zamanında mat edilemeyen 6.978 durumun 6.966'sını
(%99,8) ispatlıyor ve edilebilenlerden hiçbirini ispatlamıyor, hakem sayfasının sınırlarıyla (4 ply, 8 düğüm);
kurallı Domino araması 5.976'sını (%85,6) 20 kat düğümle ispatlıyordu. chasolver'ın pozisyonlarından 400 piyonlu oyun
sonundan çıkan 2.628 durumda 1.028'in 1.018'ini (Domino araması: 1.014), piyonlarının hepsi piyonlara karşı kilitli
650 pozisyondan çıkan 5.382 durumda 2.798'in 2.670'ini (2.270) ispatlıyor; hiçbiri yanlış değil.
Yukarıdaki durumlarda o kesin aramayla; chasolver'ın pozisyonlarında kurallara yakın ve onlardan 38 yarım hamleye
kadar uzak sayaçlarda kuralların verdiği her ispatta bu motorun türediği motorun sayaçlı aramasıyla (33.454 ispat:
hiçbirinde mat bulmadı); kurallara göre oynanan oyunlarla da (hamle kurallarıyla 6.888, tekrar kurallarıyla 13.776,
inen her bayrak oyunun sonuna kadar izlendi) denetlendi: yanlış beraberlik yok.

İkiz filler, mat edecek taraf öbür renkte şah çekebildiğinde önem kazanıyor: chasolver türünden
bestelenmiş bir pozisyonda siyahın a7 ve b8'deki iki koyu fili a8'deki şahın iki kaçışını birden
tutuyor, beyazın açık renkli fili c6'dan şah çekiyor; kaçışları saysaydı mat ağı bu matı kaçırırdı.
Kural onları yalnızca orada saymıyor.

Kasım'ın dört kuralı (pat bekçisi, piyon şahı tohumu, hamlesiz rakip, zorunlu adım) 204.060 satırın
481'ini aramadan kilide taşıyor ve kalan 6 kafesin 4'ünü ispatlıyor; her yeni kilit, ondan
ulaşılabilen bütün pozisyonlar dolaşılarak denetlendi, chasolver'ın etiketleri hiç yanlış beraberlik
vermiyor ve değişmez kontrolü sertifikalarını tanıyor ([docs/RESULTS.md](docs/RESULTS.md#the-four-rules-of-november)).
JavaScript, Rust ve WebAssembly motorlarında düğüm sayılarına kadar aynı cevaplarla, sade
dedektörün 20 dilinde de var (`lock/second/`, 60.471 pozisyonda aynı cevaplar).

**Sırada ne var**, sırasıyla: kalan 2 kafes (RwnQJq1k, bKHPqNEw), açık kalan için sınırlı tam
kapanış, ve dedektörün ve yukarıdaki kuralların yazılı sağlamlık ispatı.

## Lisans ve teşekkür

- MIT Lisansı, © 2026 Cüneyt İnan ([LICENSE](LICENSE)).
- FideLite.Art golfstack motorundan esinlenildi.
- Lichess verisi ve etiketli test pozisyonları Miguel Ambrona'nın
  [chasolver](https://github.com/miguel-ambrona/chasolver) projesinden. chasolver sekmesi
  chasolver'ın MIT lisanslı kodunun bir çevirisini çalıştırıyor (`site/chasolver/`); lisans metni
  `site/chasolver/LICENSE.txt`'te ve `index.html`'in başında. chasolver'ın kendi sitesi:
  [chasolver.org](https://chasolver.org).
- Kurallar sekmesi FideLite.Art'ın kurallarından (5. ve 6. bölümleri) uyarlandı.
- Lichess taraması [fzstd](https://github.com/101arrowz/fzstd) ile açıyor (MIT, Arjun Barrett).
