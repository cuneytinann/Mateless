// Tests Lock.scala on ../positions.tsv: scalac Lock.scala Test.scala && scala Test [positions.tsv]
import scala.io.Source

object Test {
  def main(args: Array[String]): Unit = {
    val path = if (args.nonEmpty) args(0) else "../positions.tsv"
    var n = 0
    var bad = 0
    val source = Source.fromFile(path)
    for (line <- source.getLines()) {
      if (!line.startsWith("#") && line.trim.nonEmpty) {
        val fields = line.split("\t")
        val white = fields(1) == "1"
        val black = fields(2) == "1"
        val p = Lock.fromFen(fields(0))
        val w = Lock.cannotBeMated(p, true)
        val b = Lock.cannotBeMated(p, false)
        if (w != white || b != black) {
          bad += 1
          if (bad <= 10)
            println(s"wrong: ${fields(0)} expected ${fields(1)} ${fields(2)} got ${if (w) 1 else 0} ${if (b) 1 else 0}")
        }
        n += 1
      }
    }
    source.close()
    println(s"scala: $n positions, $bad wrong")
    sys.exit(if (bad > 0) 1 else 0)
  }
}
