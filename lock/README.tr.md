# Kilit dedektörü, tek başına

[Mateless](https://github.com/cuneytinann/Mateless)'in kilit dedektörü, en sade hâliyle, 20 dilde.
Her sürüm iki yüz kadar satır ve yalnızca kendi dilinin standart kütüphanesini kullanıyor. Hepsi
satır satır aynı algoritma ve hepsi `positions.tsv`'deki 36.405 pozisyonda Mateless'in cevaplarını
veriyor.

[English](README.md) · [Nasıl çalışıyor, resimlerle](https://cuneytinann.github.io/Mateless/#lock)

## Neyi cevaplıyor

**Bu taraf asla mat edilemez mi?** Piyonlar, şahlar ve filler hiçbir geçerli hamle dizisinin
açamayacağı bir yapı kurduğunda evet. FIDE bu soruyu şu anlarda soruyor:

- **süre bittiğinde** (Madde 6.9). Süresi biten oyuncu için sor. Cevap evetse rakip mat edemez
  ve oyun berabere biter;
- **her hamleden sonra** (Madde 5.2.2). İki taraf da asla mat edilemiyorsa pozisyon ölüdür ve
  oyun o an berabere biter. Kilit yalnızca bir alıştan ya da piyon hamlesinden sonra oluşur: ya
  hemen ya da bir hamle sonra. Bu yüzden yarım hamle sayacı 0 ya da 1 iken iki taraf için de sor.

Yalnızca bitboard'ları okuyor. Hamle üretmiyor, aramıyor. Tahtada at, kale ya da vezir varsa
hemen başarısız oluyor. Bir tarafın aynı renk karelerde iki fili varsa ya da en passant alış
mümkünse de öyle. **Sağlam ama tam değil**: geçirdiği bir yapı asla açılamaz, ama geçirmediği
bir pozisyon yine de ölü olabilir. Mateless'in
[bütün merdiveni](https://github.com/cuneytinann/Mateless/blob/main/README.tr.md#merdiven)
arkasına kısa bir arama ekliyor.

## Çağırmak

```
pieces = fromFen(fen)              // ya da Pieces'ı kendi bitboard'larından doldur
cannotBeMated(pieces, white)       // true: Beyaz (false: Siyah) asla mat edilemez
```

`Pieces` sekiz alan taşıyor:

| alan | ne |
|---|---|
| beyaz piyonlar, siyah piyonlar | her tarafın piyonları |
| beyaz şah, siyah şah | her şahın karesi, tek kareli bir küme olarak |
| beyaz filler, siyah filler | her tarafın filleri |
| diğerleri | iki tarafın atları, kaleleri ve vezirleri |
| en passant | sırası gelen taraf en passant alabiliyorsa true |

Bir kare kümesi 64 bitlik bir tamsayı: a1 = 0, b1 = 1, …, h8 = 63, satranç programlarının
çoğunun düzeni. `fromFen` en passant karesini yalnızca sırası gelen tarafın bir piyonu o kareye
almaya hazır duruyorsa sayıyor. O alışın yasal olup olmadığını sormuyor. Programın bunu biliyorsa
kendin ver.

## Diller

| dil | klasör | test, klasörün içinden | denendiği sürüm |
|---|---|---|---|
| C | [`c/`](c/) | `cc -O2 -o test test.c lock.c && ./test` | GCC 13.3 |
| C++ | [`cpp/`](cpp/) | `c++ -std=c++17 -O2 -o test test.cpp && ./test` | GCC 13.3, Clang 18 |
| C# | [`csharp/`](csharp/) | `dotnet run -c Release -- ../positions.tsv` | .NET 8 |
| Crystal | [`crystal/`](crystal/) | `crystal run --release test.cr -- ../positions.tsv` | Crystal 1.11 |
| Go | [`go/`](go/) | `go test -v` | Go 1.24 |
| Haskell | [`haskell/`](haskell/) | `ghc -O2 -outputdir build -o test Test.hs && ./test` | GHC 9.4 |
| Java | [`java/`](java/) | `javac Lock.java Test.java && java Test` | Java 21 (17 ya da sonrası gerekir) |
| JavaScript | [`javascript/`](javascript/) | `node test.mjs` | Node 22 |
| Kotlin | [`kotlin/`](kotlin/) | `kotlinc Lock.kt Test.kt -include-runtime -d lock.jar && java -jar lock.jar` | Kotlin 1.3 |
| Lua | [`lua/`](lua/) | `lua test.lua` | Lua 5.4 (5.3 ya da sonrası gerekir) |
| Nim | [`nim/`](nim/) | `nim c -d:release --hints:off -r test.nim` | Nim 1.6 |
| OCaml | [`ocaml/`](ocaml/) | `ocamlopt -o test lock.mli lock.ml test.ml && ./test` | OCaml 4.14 |
| Pascal | [`pascal/`](pascal/) | `fpc -O2 test.pas && ./test` | Free Pascal 3.2 |
| PHP | [`php/`](php/) | `php test.php` | PHP 8.3 |
| Python | [`python/`](python/) | `python3 test.py` | Python 3.13 |
| Ruby | [`ruby/`](ruby/) | `ruby test.rb` | Ruby 3.3 (3.0 ya da sonrası gerekir) |
| Rust | [`rust/`](rust/) | `cargo test --release -- --nocapture` | Rust 1.97 |
| Scala | [`scala/`](scala/) | `scalac Lock.scala Test.scala && scala Test` | Scala 2.11; 2.12, 2.13 ve 3 için de yazıldı, ama 3 ile henüz derlenmedi |
| TypeScript | [`typescript/`](typescript/) | `node test.ts` | Node 22.18 ya da sonrası (türleri atarak çalıştırır); `tsc --strict` türleri denetler |
| Zig | [`zig/`](zig/) | `zig run -O ReleaseFast test.zig` | Zig 0.17 |

`sh test-all.sh`, derleyicisi kurulu olan her testi çalıştırıyor. Her test her pozisyonda iki
tarafı da cevaplıyor ve `<dil>: 36405 positions, 0 wrong` yazıyor.

## Nasıl denendi

`positions.tsv`'de her satırda bir pozisyon var: FEN, sonra Beyaz asla mat edilemiyorsa 1, yoksa
0, sonra aynısı Siyah için. Pozisyonlar şunlar:

- Lichess oyunlarından kilitler ve ayna görüntüleri;
- aynı kilitler, bazı yapıları açan, bazılarını açmayan küçük değişikliklerle: bir piyon
  ilerletilmiş, bir şah yer değiştirmiş, bir fil eklenmiş, bir en passant hakkı yaratılmış;
- rastgele kurulmuş kapalı yapılar;
- şahların, piyonların ve fillerin rastgele pozisyonları.

Hepsini Mateless'in motoru, `mateless.js`, etiketliyor. Birlikte her kapıyı, her seviyeyi ve her
sızıntıyı cevapta defalarca belirleyici kılıyorlar. Dosyayı Mateless reposundaki
`tools/lock-positions.js` yazıyor.

## Tek paragrafta algoritma

Her şahın erişimi (bir gün durabileceği her kare) kendi karesinden büyütülüyor. Asla
kıpırdayamayan bir piyonun saldırdığı bir kareye büyümüyor. Asla kıpırdayamayan piyonlar bir
duvarın tıkadıklarıdır; duvar da karşı tarafın asla alamayacağı bir piyondur. Bir tarafın piyon
alabileceği kareler şahının erişiminden büyüyor ve hiçbir şey değişmeyene kadar böyle devam
ediyor. Şunlardan biri olursa yapı sızdırıyor:

- bir piyon terfi edebiliyor ya da alış yapabiliyor;
- donmuş bir şah hareket edebiliyor;
- bir fil bir piyonun yoluna ulaşabiliyor;
- sorulan şah, karşı tarafın saldırdığı ve kesin bir kaçış karesi olmayan bir kareye
  varabiliyor.

Önce iki şah serbestken deneniyor. Sonra, bir şahın çevresindeki her kare bir piyonun elinde ya
da saldırısı altındaysa, o şah karesinde dondurularak (iki taraf için de bir duvar) deneniyor.
[Kilit dedektörü sekmesi](https://cuneytinann.github.io/Mateless/#lock) her adımı tahtalarla
anlatıyor ve herhangi bir pozisyonda adım adım ilerlemeni sağlıyor.

Bu sürümler okunmak ve başka programlara taşınmak için. Hızlı sürümler Mateless'in kendisinde:
`src/lock.js` (JavaScript, 32 bitlik kelime çiftleri üzerinde) ve `rust/src/lock.rs`. Lichess
için scalachess'in kendi türleri üzerinde bir sürüm var:
[`Lock.scala`](https://github.com/cuneytinann/scalachess/blob/dead-position-lock/core/src/main/scala/mateless/Lock.scala).

## Lisans

MIT, © 2026 Cüneyt İnan. Lisans metni `LICENSE`'ta: zip'te bu dosyanın yanında, GitHub'da reponun
kökünde.
