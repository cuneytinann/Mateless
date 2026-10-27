-- Tests Lock.hs on ../positions.tsv:
--   ghc -O2 -Wall -outputdir build -o test Test.hs && ./test [positions.tsv]
module Main (main) where

import Control.Monad (foldM, when)
import System.Environment (getArgs)
import System.Exit (exitFailure)

import Lock (cannotBeMated, fromFen)

main :: IO ()
main = do
  args <- getArgs
  let path = case args of
        arg : _ -> arg
        [] -> "../positions.tsv"
  text <- readFile path
  (n, bad) <- foldM check (0, 0) [line | line@(c : _) <- lines text, c /= '#']
  putStrLn ("haskell: " ++ show n ++ " positions, " ++ show bad ++ " wrong")
  when (bad > 0) exitFailure

-- | One line: counts it, and prints it if it is one of the first 10 wrong ones.
check :: (Int, Int) -> String -> IO (Int, Int)
check (n, bad) line = case break (== '\t') line of
  (fen, '\t' : white : '\t' : black : _) -> do
    let p = fromFen fen
        got = (cannotBeMated p True, cannotBeMated p False)
        wrong = got /= (white == '1', black == '1')
        bad' = if wrong then bad + 1 else bad
    when (wrong && bad' <= 10) $
      putStrLn (unwords ["wrong:", fen, "expected", [white], [black], "got", digit (fst got), digit (snd got)])
    n `seq` bad' `seq` return (n + 1, bad')
  _ -> return (n, bad)
  where
    digit b = show (fromEnum b)
