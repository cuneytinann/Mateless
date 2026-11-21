// Tests Lock.java on ../positions.tsv: javac Lock.java Test.java && java Test [positions.tsv]
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

public final class Test {
    public static void main(String[] args) throws IOException {
        String path = args.length > 0 ? args[0] : "../positions.tsv";
        long n = 0, bad = 0;
        for (String line : Files.readAllLines(Path.of(path))) {
            if (line.startsWith("#") || line.isBlank()) continue;
            String[] fields = line.split("\t");
            boolean white = fields[1].equals("1"), black = fields[2].equals("1");
            Lock.Pieces p = Lock.fromFen(fields[0]);
            boolean w = Lock.cannotBeMated(p, true), b = Lock.cannotBeMated(p, false);
            if (w != white || b != black) {
                if (++bad <= 10)
                    System.out.println("wrong: " + fields[0] + " expected " + fields[1] + " " + fields[2]
                                       + " got " + (w ? 1 : 0) + " " + (b ? 1 : 0));
            }
            n++;
        }
        System.out.println("java: " + n + " positions, " + bad + " wrong");
        System.exit(bad > 0 ? 1 : 0);
    }
}
