use super::*;
use image::{ImageBuffer, Rgba};
use lopdf::dictionary;

fn png(transparent_bg: bool) -> Vec<u8> {
    let bg = if transparent_bg { Rgba([0u8, 0, 0, 0]) } else { Rgba([255, 255, 255, 255]) };
    let img = ImageBuffer::from_fn(40, 20, |x, y| {
        // A black "L" so orientation is visible in rendered output.
        if x < 6 || y > 13 { Rgba([0, 0, 0, 255]) } else { bg }
    });
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, ImageFormat::Png).unwrap();
    out.into_inner()
}

/// A two-page PDF; resources are inherited from the Pages node.
fn sample_pdf(rotate: i64) -> Vec<u8> {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let mut kids = vec![];
    for n in 1..=2 {
        let content = doc.add_object(Stream::new(
            dictionary! {},
            format!("0.85 0.9 1 rg 0 0 612 792 re f 1 0 0 rg 20 700 40 40 re f % page {n}").into_bytes(),
        ));
        let page = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "Contents" => content,
            "Rotate" => rotate,
        });
        kids.push(Object::Reference(page));
    }
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => kids,
            "Count" => 2,
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            "Resources" => dictionary! { "ProcSet" => vec![Object::Name(b"PDF".to_vec())] },
        }),
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog);
    let mut out = Vec::new();
    doc.save_to(&mut out).unwrap();
    out
}

fn stamp(page: u32, rotation: u32, image: Vec<u8>) -> Stamp {
    Stamp { page, x: 100.0, y: 500.0, width: 200.0, height: 100.0, rotation, image }
}

fn corners(m: [f64; 6]) -> [(f64, f64); 3] {
    let at = |x: f64, y: f64| (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
    [at(0.0, 0.0), at(1.0, 0.0), at(0.0, 1.0)]
}

#[test]
fn matrix_places_image_corners_per_rotation() {
    let c = |r| corners(image_matrix(10.0, 20.0, 100.0, 50.0, r).unwrap());
    assert_eq!(c(0), [(10.0, 20.0), (110.0, 20.0), (10.0, 70.0)]);
    assert_eq!(c(90), [(110.0, 20.0), (110.0, 70.0), (10.0, 20.0)]);
    assert_eq!(c(180), [(110.0, 70.0), (10.0, 70.0), (110.0, 20.0)]);
    assert_eq!(c(270), [(10.0, 70.0), (10.0, 20.0), (110.0, 70.0)]);
}

#[test]
fn matrix_rejects_odd_rotation() {
    assert!(image_matrix(0.0, 0.0, 1.0, 1.0, 45).is_err());
}

#[test]
fn stamps_only_the_requested_page() {
    let out = stamp_pdf(&sample_pdf(0), &[stamp(2, 0, png(true))]).unwrap();
    let doc = Document::load_mem(&out).unwrap();
    let pages = doc.get_pages();

    let contents = |n: u32| -> usize {
        let page = doc.get_dictionary(pages[&n]).unwrap();
        match page.get(b"Contents").unwrap() {
            Object::Array(a) => a.len(),
            _ => 1,
        }
    };
    assert_eq!(contents(1), 1, "page 1 must be untouched");
    assert_eq!(contents(2), 4, "page 2 = q, original, Q, stamp");
    assert!(doc.get_dictionary(pages[&1]).unwrap().get(b"Resources").is_err());
}

#[test]
fn embeds_alpha_as_smask_and_keeps_inherited_resources() {
    let out = stamp_pdf(&sample_pdf(0), &[stamp(1, 0, png(true))]).unwrap();
    let doc = Document::load_mem(&out).unwrap();
    let page_id = doc.get_pages()[&1];
    let res = doc.get_dictionary(page_id).unwrap().get(b"Resources").unwrap().as_dict().unwrap();
    assert!(res.has(b"ProcSet"), "inherited resources must be preserved");

    let xobjects = res.get(b"XObject").unwrap().as_dict().unwrap();
    let image_id = xobjects.get(b"PdfSignerIm1").unwrap().as_reference().unwrap();
    let image = doc.get_object(image_id).unwrap().as_stream().unwrap();
    assert!(image.dict.has(b"SMask"));
    assert_eq!(image.dict.get(b"Width").unwrap().as_i64().unwrap(), 40);
}

#[test]
fn opaque_image_has_no_smask() {
    let out = stamp_pdf(&sample_pdf(0), &[stamp(1, 0, png(false))]).unwrap();
    let doc = Document::load_mem(&out).unwrap();
    let page_id = doc.get_pages()[&1];
    let res = doc.get_dictionary(page_id).unwrap().get(b"Resources").unwrap().as_dict().unwrap();
    let xobjects = res.get(b"XObject").unwrap().as_dict().unwrap();
    let id = xobjects.get(b"PdfSignerIm1").unwrap().as_reference().unwrap();
    assert!(!doc.get_object(id).unwrap().as_stream().unwrap().dict.has(b"SMask"));
}

#[test]
fn stamp_stream_draws_the_image_with_the_matrix() {
    let out = stamp_pdf(&sample_pdf(0), &[stamp(1, 0, png(true))]).unwrap();
    let doc = Document::load_mem(&out).unwrap();
    let content = doc.get_page_content(doc.get_pages()[&1]);
    let text = String::from_utf8_lossy(&content);
    assert!(text.contains("q 200.0000 0.0000 0.0000 100.0000 100.0000 500.0000 cm /PdfSignerIm1 Do Q"));
}

#[test]
fn rejects_bad_input() {
    let pdf = sample_pdf(0);
    assert!(stamp_pdf(&pdf, &[stamp(3, 0, png(true))]).unwrap_err().contains("no page 3"));
    assert!(stamp_pdf(&pdf, &[stamp(1, 0, b"not an image".to_vec())]).is_err());
    assert!(stamp_pdf(b"not a pdf", &[stamp(1, 0, png(true))]).is_err());
    let mut zero = stamp(1, 0, png(true));
    zero.width = 0.0;
    assert!(stamp_pdf(&pdf, &[zero]).is_err());
}

/// Writes stamped PDFs for manual/visual inspection when STAMP_OUT_DIR is set.
#[test]
fn dump_samples_for_inspection() {
    let Ok(dir) = std::env::var("STAMP_OUT_DIR") else { return };
    for rotation in [0u32, 90, 180, 270] {
        let out = stamp_pdf(&sample_pdf(rotation as i64), &[stamp(1, rotation, png(true))]).unwrap();
        std::fs::write(format!("{dir}/rot{rotation}.pdf"), out).unwrap();
    }
}

/// Stamps page 1 of a real-world PDF (STAMP_SAMPLE_PDF) for manual inspection.
#[test]
fn dump_real_pdf_for_inspection() {
    let (Ok(dir), Ok(path)) = (std::env::var("STAMP_OUT_DIR"), std::env::var("STAMP_SAMPLE_PDF")) else {
        return;
    };
    let pdf = std::fs::read(path).unwrap();
    let out = stamp_pdf(&pdf, &[stamp(1, 0, png(true))]).unwrap();
    std::fs::write(format!("{dir}/real.pdf"), out).unwrap();
}

#[test]
fn stamps_several_signatures_across_pages_and_on_one_page() {
    let stamps = [
        stamp(1, 0, png(true)),
        Stamp { x: 300.0, y: 300.0, ..stamp(1, 0, png(false)) },
        stamp(2, 0, png(true)),
    ];
    let out = stamp_pdf(&sample_pdf(0), &stamps).unwrap();
    let doc = Document::load_mem(&out).unwrap();
    let pages = doc.get_pages();

    let draws = |n: u32| {
        let text = String::from_utf8_lossy(&doc.get_page_content(pages[&n])).to_string();
        text.matches(" Do Q").count()
    };
    assert_eq!(draws(1), 2);
    assert_eq!(draws(2), 1);

    let xobject_names = |n: u32| -> Vec<String> {
        let res = doc.get_dictionary(pages[&n]).unwrap().get(b"Resources").unwrap().as_dict().unwrap();
        let xo = res.get(b"XObject").unwrap().as_dict().unwrap();
        let mut names: Vec<String> = xo.iter().map(|(k, _)| String::from_utf8_lossy(k).into()).collect();
        names.sort();
        names
    };
    assert_eq!(xobject_names(1), ["PdfSignerIm1", "PdfSignerIm2"]);
    assert_eq!(xobject_names(2), ["PdfSignerIm3"]);
}
