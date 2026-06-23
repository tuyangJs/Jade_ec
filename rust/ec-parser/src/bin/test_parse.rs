use std::env;
use std::fs;
use std::path::Path;

use ec_parser::parser::parse_ec;

fn main() {
    let path = env::args().nth(1).expect("usage: test_parse <ec-file>");
    let data = fs::read(&path).expect("failed to read ec file");
    match parse_ec(&data, false) {
        Ok(module) => {
            let json = serde_json::to_string_pretty(&module).unwrap();
            let json_path = Path::new(&path).with_extension("json");
            fs::write(&json_path, json).expect("failed to write json file");
            println!("written {}", json_path.display());
        }
        Err(err) => {
            eprintln!("parse error: {}", err);
            std::process::exit(1);
        }
    }
}
