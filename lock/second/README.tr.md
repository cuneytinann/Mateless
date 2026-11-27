# Kilit dedektörü, ikinci sürüm, tek başına

[Mateless](https://github.com/cuneytinann/Mateless)'in kilit dedektörünün ikinci sürümü, en sade
hâliyle, ilk sürümle aynı 20 dilde (ilk sürüm bir üst klasörde, [`../`](../)). Her sürüm 470 ile
650 satır arası ve yalnızca kendi dilinin standart kütüphanesini kullanıyor. Hepsi satır satır aynı
algoritma ve hepsi `positions.tsv`'deki 65.956 pozisyonda Mateless'in ikinci sürümünün cevaplarını
veriyor.

[English](README.md) · [İlk sürüm](../README.tr.md)

## Neyi cevaplıyor

İlk sürümle aynı soruyu: **bu taraf asla mat edilemez mi?** Tahtadaki taşlar hiçbir geçerli hamle
dizisinin açamayacağı bir yapı kurduğunda evet (FIDE 5.2.2 ölü pozisyon, 6.9 süre bitimi).
Bitboard'ları ve sıranın kimde olduğunu okuyor. Hamle üretmiyor, aramıyor. **Sağlam ama tam
değil**: geçirdiği bir yapı asla açılamaz, ama geçirmediği bir pozisyon yine de ölü olabilir.

İlk sürümün hepsini koruyor ve yedi kural ekliyor. Her biri yalnızca kendi durumu tahtadayken
çalışıyor; başka her pozisyonda ilk sürümün cevabını veriyor.

- **Önü açık piyon çiftleri.** Aynı dikeyde, aralarında tek boş kare olan bir beyaz ve bir siyah
  piyon. Ardından gelebilecek pozisyonlar, çiftin piyonlarının ne yaptığına göre ailelere
  ayrılıyor: hiçbiri oynamadı, beyaz olan boşluğa ilerledi ya da siyah olan ilerledi. Her aile bir
  kilit gibi deneniyor. En fazla 3 çift (27 aile).
- **Kutulu at, kale ve vezir.** Adım attığı her karede kendi tarafının asla kıpırdamayan
  bir taşı duran ve hiçbir rakip şahın ya da filin ulaşmadığı bir taş asla oynamaz ve asla
  alınmaz. Böyle bir taş sabit bir piyon, kutulu başka bir taş, hareketsiz bir fil (her çapraz
  komşusu aynı biçimde tutulmuş, hiçbir rakip şahın ya da filin ulaşmadığı) ya da taşın kendi
  şahı olabilir; şah donmuşsa, tarafının hiç rok hakkı kalmamışsa ve bir rokun onu kalesinin yanında
  bıraktığı yerde durmuyorsa (f1'de kaleyle g1, d1'de kaleyle c1; g8, f8, c8, d8): rok yarım hamle
  sayacını olduğu gibi bırakıyor, yani dedektör roktan sonra sorulmuyor (aşağıya bakın). Başka her
  at, kale ya da vezir dedektörü yine hemen düşürüyor.
- **İkiz filler.** Bir tarafın aynı renk karelerde iki fili artık dedektörü düşürmüyor. Kendi
  şahlarının iki kaçış karesini birden kapatabildikleri yerde mat ağı o kaçışlara güvenmiyor.
- **Pat bekçisi.** Rakip şahın alabileceği bir piyon, onu almak sahibini her seferinde pat
  ediyorsa duvar olarak kalıyor.
- **Piyon şahı tohumu.** Piyon şahındaki bir şahın erişimi, adım atabileceği karelerden başlıyor.
- **Hamlesiz rakip.** Süresi biten taraf ne oynarsa oynasın, mat edecek tarafın yasal hamlesi
  kalmıyor.
- **Zorunlu adım.** Piyon şahındaki bir şahın tek yasal hamlesi bir adımsa, cevap o adımdan sonraki
  pozisyonun kilididir.

Mümkün bir en passant alış onu yine hemen düşürüyor.

Ne zaman sorulacağı ilk sürümdeki gibi: süre bittiğinde, süresi biten oyuncu için; her hamleden
sonra da, yarım hamle sayacı 0 ya da 1 iken iki taraf için (ikisi de evetse pozisyon ölü).

## Çağırmak

```
pieces = fromFen(fen)              // ya da Pieces'ı kendi bitboard'larından doldur
cannotBeMated(pieces, white)       // true: Beyaz (false: Siyah) asla mat edilemez
```

`Pieces` on altı alan taşıyor. İkinci sürüm her taş türünü ayrı ayrı, sıranın kimde olduğunu ve
her tarafın hâlâ rok yapıp yapamayacağını istiyor:

| alan | ne |
|---|---|
| beyaz piyonlar, siyah piyonlar | her tarafın piyonları |
| beyaz şah, siyah şah | her şahın karesi, tek kareli bir küme olarak |
| beyaz filler, siyah filler | her tarafın filleri |
| beyaz atlar, siyah atlar | her tarafın atları |
| beyaz kaleler, siyah kaleler | her tarafın kaleleri |
| beyaz vezirler, siyah vezirler | her tarafın vezirleri |
| sıra beyazda | sıra Beyaz'daysa true |
| en passant | sırası gelen taraf en passant alabiliyorsa true |
| beyaz rok, siyah rok | o tarafın hâlâ bir rok hakkı varsa true |

Bir kare kümesi 64 bitlik bir tamsayı: a1 = 0, b1 = 1, …, h8 = 63. `fromFen` en passant karesini
yalnızca sırası gelen tarafın bir piyonu o kareye almaya hazır duruyorsa sayıyor. O alışın yasal
olup olmadığını sormuyor. Programın bunu biliyorsa kendin ver. Rok alanını KQkq olarak ya da dikey
harfleriyle (Shredder-FEN, Chess960) okuyor ve bir hakkı yalnızca şahı kendi ilk yatayında, o
renkten bir kale de aynı yatayda şahın o yanında (harfle yazılmışsa o dikeyde) duruyorsa sayıyor. Bir
hak yalnızca kendi taşını kutulayan bir şah için önemli: hak durdukça şah rok yapıp gidebilir, yani
hiçbir şeyi tutmuyor. Mateless ayrıca dikeyleri öbür tarafınkiyle çelişen bir hakkı düşürüyor (iki
taraf için tek rok iskeleti); bu sürüm böyle bir hakkı tutuyor, yani böyle bir FEN'de Mateless'ten
az ispatlayabilir, asla fazla değil.

## Diller

| dil | klasör | test, klasörün içinden | denendiği sürüm |
|---|---|---|---|
| C | [`c/`](c/) | `cc -O2 -o test test.c lock.c && ./test` | GCC 13.3, Clang 18 |
| C++ | [`cpp/`](cpp/) | `c++ -std=c++17 -O2 -o test test.cpp && ./test` | GCC 13.3, Clang 18 |
| C# | [`csharp/`](csharp/) | `dotnet run -c Release -- ../positions.tsv` | .NET 8 |
| Crystal | [`crystal/`](crystal/) | `crystal run --release test.cr -- ../positions.tsv` | Crystal 1.14 |
| Go | [`go/`](go/) | `go test -v` | Go 1.24 |
| Haskell | [`haskell/`](haskell/) | `ghc -O2 -outputdir build -o test Test.hs && ./test` | GHC 9.4 |
| Java | [`java/`](java/) | `javac Lock.java Test.java && java Test` | Java 21 (17 ya da sonrası gerekir) |
| JavaScript | [`javascript/`](javascript/) | `node test.mjs` | Node 22 |
| Kotlin | [`kotlin/`](kotlin/) | `kotlinc Lock.kt Test.kt -include-runtime -d lock.jar && java -jar lock.jar` | Kotlin 1.3, 2.1 |
| Lua | [`lua/`](lua/) | `lua test.lua` | Lua 5.4 (5.3 ya da sonrası gerekir) |
| Nim | [`nim/`](nim/) | `nim c -d:release --hints:off -r test.nim` | Nim 1.6 |
| OCaml | [`ocaml/`](ocaml/) | `ocamlopt -o test lock.mli lock.ml test.ml && ./test` | OCaml 4.14 |
| Pascal | [`pascal/`](pascal/) | `fpc -O2 test.pas && ./test` | Free Pascal 3.2 |
| PHP | [`php/`](php/) | `php test.php` | PHP 8.3 |
| Python | [`python/`](python/) | `python3 test.py` | Python 3.13 |
| Ruby | [`ruby/`](ruby/) | `ruby test.rb` | Ruby 3.3 (3.0 ya da sonrası gerekir) |
| Rust | [`rust/`](rust/) | `cargo test --release -- --nocapture` | Rust 1.97 |
| Scala | [`scala/`](scala/) | `scalac Lock.scala Test.scala && scala Test` | Scala 2.11, 3.8 (3.5'ten itibaren: `scala run -cp . -M Test`) |
| TypeScript | [`typescript/`](typescript/) | `node test.ts` | Node 22.18 ya da sonrası (türleri atarak çalıştırır); `tsc --strict` türleri denetler |
| Zig | [`zig/`](zig/) | `zig run -O ReleaseFast test.zig` | Zig 0.17 |

`sh test-all.sh`, derleyicisi kurulu olan her testi çalıştırıyor. Her test her pozisyonda iki
tarafı da cevaplıyor ve `<dil>: 65956 positions, 0 wrong` yazıyor.

## Nasıl denendi

`positions.tsv`'de her satırda bir pozisyon var: FEN, sonra Beyaz asla mat edilemiyorsa 1, yoksa
0, sonra aynısı Siyah için. Hepsini Mateless'in motoru `mateless.js`'teki ikinci sürüm dedektörü
(`lockCannotMate`) etiketliyor. Pozisyonlar şunlar:

- ilk sürümün dosyasındaki (`../positions.tsv`) her pozisyon, yeniden etiketlenmiş;
- Mateless'in ikinci sürüm verisindeki ve kural örneklerindeki pozisyonlar, ayna görüntüleriyle;
- Lichess kilitleri, bir kurala şans verecek biçimde değiştirilmiş: bir piyon kilitlenmesi önü
  açık bir çifte ayrılmış, bir at, kale ya da vezir kendi piyonlarıyla kutulanmış, sırası gelen
  tarafın şahı bir piyon şahına girmiş, iki şah da herhangi bir yere taşınmış. Her kilit ve her
  değişiklik için kuralın ispatladığı bir pozisyon ve ispatlamadığı bir pozisyon;
- kutulu bir taşın piyon olmayan duvarları: Lichess kilitlerine aynı biçimde konmuş, kısmen
  kendi renginden hareketsiz bir filin ya da kendi şahının kutuladığı bir at, kale ya da vezir;
  piyonu ve bir filin kutuladığı bir kale ile birbirini tutan bir şah, kale ve fil, her biri filsiz
  ya da şahsız hâliyle de; aynıları bir rok hakkı kalmış olarak ve tahtanın taşıyamayacağı bir hakla;
  iki kale arasında bir şah, bir rokun şahı ve kaleyi bıraktığı yerde ve bırakmadığı yerde.

38.265 "asla mat edilemez" cevabının 31.256'sı ilk sürümün. Kalanı yeni kurallardan:

| kural | cevap |
|---|---|
| yeni seviye: ikiz filler, pat bekçisi, piyon şahı tohumu | 5.653 |
| zorunlu adım | 618 |
| kutulu at, kale ve vezir (466'sının duvarlarında hareketsiz bir fil ya da şah var) | 580 |
| önü açık piyon çiftleri | 92 |
| hamlesiz rakip | 66 |

Her dil ayrıca 183.461 başka pozisyonda ve rok alanını denemek için yazılmış 206.149 pozisyonda
(bir piyon zinciri üstünde ilk yatayda şah, kaleler ve filler, tahtanın izin verdiği her rok alanıyla)
Mateless'in cevaplarını veriyor.

Dosyayı Mateless reposundaki `tools/lock-positions.js` yazıyor.

Bu sürümler okunmak ve başka programlara taşınmak için. Hızlı sürümler Mateless'in kendisinde,
`second-version` dalında: `src/lock.js` ve `rust/src/lock.rs` (WebAssembly olarak da). Her kuralın nasıl
çalıştığı ve nasıl denendiği:
[docs/DESIGN.md, 12. bölüm](https://github.com/cuneytinann/Mateless/blob/second-version/docs/DESIGN.md#12-the-second-version).

## Lisans

MIT, © 2026 Cüneyt İnan. Lisans metni `LICENSE`'ta: zip'te bir üst klasörde, GitHub'da reponun
kökünde.
