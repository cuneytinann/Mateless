// Tests Lock.kt on ../positions.tsv: kotlinc Lock.kt Test.kt -include-runtime -d lock.jar && java -jar lock.jar [positions.tsv]
import java.io.File
import kotlin.system.exitProcess

fun main(args: Array<String>) {
    val path = if (args.isNotEmpty()) args[0] else "../positions.tsv"
    var n = 0
    var bad = 0
    for (line in File(path).readLines()) {
        if (line.startsWith("#") || line.isBlank()) continue
        val (fen, white, black) = line.split("\t")
        val p = Lock.fromFen(fen)
        val w = Lock.cannotBeMated(p, true)
        val b = Lock.cannotBeMated(p, false)
        if (w != (white == "1") || b != (black == "1")) {
            if (++bad <= 10) println("wrong: $fen expected $white $black got ${if (w) 1 else 0} ${if (b) 1 else 0}")
        }
        n++
    }
    println("kotlin: $n positions, $bad wrong")
    exitProcess(if (bad > 0) 1 else 0)
}
